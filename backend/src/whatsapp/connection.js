// Multi-tenant WhatsApp connection manager. Each tenant gets their own
// Baileys socket, keyed by user_id, with auth state persisted entirely in
// Supabase (supabaseAuthState.js) — no per-tenant auth folder on disk, so
// any number of tenants can be connected on a single free-tier instance
// without the ephemeral disk ever holding a session that matters.
'use strict';

const { Boom } = require('@hapi/boom');
const QRCode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const {
  default: makeWASocket,
  fetchLatestBaileysVersion,
  DisconnectReason,
} = require('@whiskeysockets/baileys');

const { useSupabaseAuthState } = require('./supabaseAuthState');
const { isLikelyRealEstateMessage } = require('../shared/keywordFilter');
const { extractLeadFromMessage } = require('../ai/geminiExtract');
const { saveLead } = require('../db/leads');
const { getSettings } = require('../db/settings');
const { resolveRole } = require('../classify/classifier');
const supabase = require('../db/supabaseClient');

// Baileys rotates the QR roughly every 20s until it's scanned; used to give
// the frontend a countdown so it knows when to expect the next one.
const QR_VALIDITY_MS = 20_000;

// One entry per connected tenant:
// { sock, status, qrDataUrl, qrExpiresAt, phone, profilePictureUrl, error }
// status: 'connecting' | 'qr_pending' | 'connected' | 'disconnected' | 'error'
const connections = new Map();

function getConnectionInfo(userId) {
  const entry = connections.get(userId);
  if (!entry) return { status: 'disconnected' };
  return {
    status: entry.status,
    qr: entry.qrDataUrl || null,
    qrExpiresAt: entry.qrExpiresAt || null,
    phone: entry.phone || null,
    profilePictureUrl: entry.profilePictureUrl || null,
    error: entry.error || null,
  };
}

/**
 * Starts (or reuses) a tenant's WhatsApp connection.
 * @param {string} userId
 */
async function startWhatsAppConnection(userId) {
  const existing = connections.get(userId);
  if (existing && (existing.status === 'connected' || existing.status === 'qr_pending')) {
    return existing;
  }

  const entry = { sock: null, status: 'connecting', qrDataUrl: null };
  connections.set(userId, entry);

  try {
    const { state, saveCreds } = await useSupabaseAuthState(userId);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({ auth: state, version });
    entry.sock = sock;

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (update) => handleConnectionUpdate(userId, entry, sock, update));
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        handleIncomingMessage(userId, msg).catch((err) =>
          console.error(`[whatsapp:${userId}] خطا در پردازش پیام:`, err.message)
        );
      }
    });
  } catch (err) {
    entry.status = 'error';
    entry.error = err.message;
    console.error(`[whatsapp:${userId}] راه‌اندازی اتصال شکست خورد:`, err.message);
  }

  return entry;
}

async function handleConnectionUpdate(userId, entry, sock, update) {
  const { connection, lastDisconnect, qr } = update;

  if (qr) {
    entry.status = 'qr_pending';
    entry.qrDataUrl = await QRCode.toDataURL(qr);
    entry.qrExpiresAt = new Date(Date.now() + QR_VALIDITY_MS).toISOString();
    qrcodeTerminal.generate(qr, { small: true }); // convenient for local/dev use
    console.log(`[whatsapp:${userId}] QR تازه صادر شد — از داشبورد یا ترمینال اسکن کنید.`);
  }

  if (connection === 'close') {
    entry.status = 'disconnected';
    const statusCode =
      lastDisconnect?.error instanceof Boom ? lastDisconnect.error.output?.statusCode : undefined;
    const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
    console.log(
      `[whatsapp:${userId}] اتصال قطع شد.`,
      shouldReconnect ? 'در حال تلاش مجدد...' : 'خروج کامل — باید دوباره از داشبورد QR بزنید.'
    );
    await supabase.from('whatsapp_sessions').update({ connected: false }).eq('user_id', userId);
    if (shouldReconnect) setTimeout(() => startWhatsAppConnection(userId), 3000);
  } else if (connection === 'open') {
    entry.status = 'connected';
    entry.qrDataUrl = null;
    entry.qrExpiresAt = null;
    entry.error = null;
    entry.phone = sock.user?.id ? sock.user.id.split(':')[0].split('@')[0] : null;
    entry.profilePictureUrl = sock.user?.id
      ? await sock.profilePictureUrl(sock.user.id, 'image').catch(() => null)
      : null;
    await supabase.from('whatsapp_sessions').update({ connected: true }).eq('user_id', userId);
    console.log(`[whatsapp:${userId}] ✅ به واتساپ وصل شد (${entry.phone}).`);
  }
}

async function handleIncomingMessage(userId, msg) {
  if (!msg.message) return;
  const jid = msg.key.remoteJid;
  if (!jid || !jid.endsWith('@s.whatsapp.net')) return; // فقط چت‌های شخصی، نه گروه‌ها

  const text =
    msg.message.conversation ||
    msg.message.extendedTextMessage?.text ||
    msg.message.imageMessage?.caption ||
    '';
  if (!isLikelyRealEstateMessage(text)) return; // فیلتر ارزان قبل از فراخوانی AI

  const phone = jid.split('@')[0];
  const senderName = msg.pushName || undefined;

  const extracted = await extractLeadFromMessage(text, { senderName });
  if (!extracted.is_relevant) return;

  // Let the tenant's editable keywords break ties the AI left as unknown.
  extracted.role = resolveRole(extracted, text, await getSettings(userId));

  await saveLead(userId, extracted, {
    source: 'whatsapp',
    chatId: jid,
    senderName,
    telegramId: null,
    phone,
    rawMessage: text,
  });

  console.log(
    `[whatsapp:${userId}] لید تازه ذخیره شد (${extracted.role} / ${extracted.request_type}) از ${senderName || phone}`
  );
}

/** Logs the tenant out and forgets the in-memory connection (used by the
 * dashboard's "Disconnect" button). A fresh connect afterwards will need a
 * new QR scan, since logout invalidates the stored credentials. */
async function disconnectWhatsApp(userId) {
  const entry = connections.get(userId);
  if (entry?.sock) {
    await entry.sock.logout().catch(() => {});
  }
  connections.delete(userId);
  await supabase.from('whatsapp_sessions').update({ connected: false }).eq('user_id', userId);
}

/** Reconnects every tenant that was connected before the last restart. */
async function resumeAllTenantConnections() {
  const { data: sessions, error } = await supabase
    .from('whatsapp_sessions')
    .select('user_id')
    .eq('connected', true);
  if (error) {
    console.error('[whatsapp] خواندن فهرست نشست‌های واتساپ شکست خورد:', error.message);
    return;
  }
  for (const { user_id: userId } of sessions || []) {
    startWhatsAppConnection(userId).catch((err) =>
      console.error(`[whatsapp] ازسرگیری اتصال برای ${userId} شکست خورد:`, err.message)
    );
  }
}

module.exports = {
  startWhatsAppConnection,
  disconnectWhatsApp,
  getConnectionInfo,
  resumeAllTenantConnections,
};
