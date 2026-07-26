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
const { getChat, upsertChat } = require('../db/chats');
const { getSettings } = require('../db/settings');
const { resolveRole } = require('../classify/classifier');
const supabase = require('../db/supabaseClient');

// Baileys rotates the QR roughly every 20s until it's scanned; used to give
// the frontend a countdown so it knows when to expect the next one.
const QR_VALIDITY_MS = 20_000;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// One entry per connected tenant:
// { sock, status, qrDataUrl, qrExpiresAt, pairingCode, usePairing, phone, profilePictureUrl, error }
// status: 'connecting' | 'pairing_pending' | 'qr_pending' | 'connected' | 'disconnected' | 'error'
const connections = new Map();

function getConnectionInfo(userId) {
  const entry = connections.get(userId);
  if (!entry) return { status: 'disconnected' };
  return {
    status: entry.status,
    pairingCode: entry.pairingCode || null,
    qr: entry.qrDataUrl || null,
    qrExpiresAt: entry.qrExpiresAt || null,
    phone: entry.phone || null,
    profilePictureUrl: entry.profilePictureUrl || null,
    error: entry.error || null,
  };
}

// WhatsApp needs the socket's websocket up before it will issue a pairing
// code, so we wait a moment and retry once if the first attempt is too early.
async function requestPairingWithRetry(sock, digits) {
  await delay(2500);
  try {
    return await sock.requestPairingCode(digits);
  } catch (err) {
    await delay(2500);
    return await sock.requestPairingCode(digits);
  }
}

/**
 * Starts (or reuses) a tenant's WhatsApp connection. When `phone` is given and
 * the session isn't registered yet, uses the mobile-friendly pairing-code flow
 * (the user types an 8-char code into WhatsApp) instead of a QR scan.
 * @param {string} userId
 * @param {string} [phone] digits with country code (e.g. "9715xxxxxxx")
 */
async function startWhatsAppConnection(userId, phone) {
  const existing = connections.get(userId);
  if (existing && (existing.status === 'connected' || existing.status === 'pairing_pending')) {
    return existing;
  }

  const entry = { sock: null, status: 'connecting', qrDataUrl: null, pairingCode: null, usePairing: Boolean(phone) };
  connections.set(userId, entry);

  try {
    const { state, saveCreds } = await useSupabaseAuthState(userId);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      auth: state,
      version,
      printQRInTerminal: false,
      browser: ['Estatemate', 'Chrome', '1.0'],
    });
    entry.sock = sock;

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (update) => handleConnectionUpdate(userId, entry, sock, update));
    // On connect, Baileys streams the account's recent chat history in one or
    // more batches. Mirror those chats into the inbox so opening WhatsApp shows
    // past conversations too (like Telegram's sync) — not just new messages.
    sock.ev.on('messaging-history.set', (payload) => {
      handleHistorySync(userId, payload).catch((err) =>
        console.error(`[whatsapp:${userId}] همگام‌سازی تاریخچه شکست خورد:`, err.message)
      );
    });
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        handleIncomingMessage(userId, msg).catch((err) =>
          console.error(`[whatsapp:${userId}] خطا در پردازش پیام:`, err.message)
        );
      }
    });

    // Pairing-code flow: ask WhatsApp for the code the user enters in their app
    // (Linked devices → Link with phone number). Only when a phone is supplied
    // and this session hasn't been linked before.
    if (phone && !sock.authState.creds.registered) {
      const digits = String(phone).replace(/[^0-9]/g, '');
      entry.status = 'pairing_pending';
      try {
        entry.pairingCode = await requestPairingWithRetry(sock, digits);
        console.log(`[whatsapp:${userId}] کد اتصال صادر شد: ${entry.pairingCode}`);
      } catch (err) {
        entry.status = 'error';
        entry.error = `دریافت کد اتصال ناموفق بود: ${err.message}`;
        console.error(`[whatsapp:${userId}] درخواست pairing code شکست خورد:`, err.message);
      }
    }
  } catch (err) {
    entry.status = 'error';
    entry.error = err.message;
    console.error(`[whatsapp:${userId}] راه‌اندازی اتصال شکست خورد:`, err.message);
  }

  return entry;
}

async function handleConnectionUpdate(userId, entry, sock, update) {
  const { connection, lastDisconnect, qr } = update;

  // In pairing-code mode we ignore the QR entirely (the user links by code).
  if (qr && !entry.usePairing) {
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
    const registered = sock.authState?.creds?.registered;
    // Only auto-reconnect an already-linked session; a half-finished pairing
    // should wait for the user to start over (so we don't loop on a stale code).
    const shouldReconnect = statusCode !== DisconnectReason.loggedOut && registered;
    console.log(
      `[whatsapp:${userId}] اتصال قطع شد.`,
      shouldReconnect ? 'در حال تلاش مجدد...' : 'خروج کامل — باید دوباره از داشبورد وصل کنید.'
    );
    await supabase.from('whatsapp_sessions').update({ connected: false }).eq('user_id', userId);
    if (shouldReconnect) setTimeout(() => startWhatsAppConnection(userId), 3000);
  } else if (connection === 'open') {
    entry.status = 'connected';
    entry.qrDataUrl = null;
    entry.qrExpiresAt = null;
    entry.pairingCode = null;
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
  if (!jid) return;
  const isGroup = jid.endsWith('@g.us'); // colleague group → A2A market
  const isDirect = jid.endsWith('@s.whatsapp.net'); // personal 1:1 chat
  if (!isGroup && !isDirect) return; // ignore broadcasts/status/etc.
  const context = isGroup ? 'group' : 'direct';

  const text =
    msg.message.conversation ||
    msg.message.extendedTextMessage?.text ||
    msg.message.imageMessage?.caption ||
    '';
  if (!text) return;

  // In a group the sender is the participant, not the chat jid.
  const senderJid = isGroup ? msg.key.participant : jid;
  const phone = senderJid ? senderJid.split('@')[0].split(':')[0] : null;
  const senderName = msg.pushName || undefined;

  // Only real-estate messages hit the AI (cost control); classify once and
  // reuse the result for both the inbox chat label and the lead/A2A pipeline.
  const relevant = isLikelyRealEstateMessage(text);
  let extracted = relevant ? await extractLeadFromMessage(text, { senderName }) : null;
  if (extracted && extracted.is_relevant && context === 'direct') {
    extracted.role = resolveRole(extracted, text, await getSettings(userId));
  }

  // Inbox: record every chat (not just real-estate ones), labelled only when
  // the AI actually classified a relevant message; never overwrite a manual label.
  try {
    const existing = await getChat(userId, 'whatsapp', jid);
    let role = existing?.role || 'unknown';
    let roleSource = existing?.role_source || 'ai';
    if (extracted && extracted.is_relevant && extracted.role && roleSource !== 'manual') {
      role = extracted.role;
      roleSource = 'ai';
    }
    await upsertChat(userId, {
      source: 'whatsapp',
      chatId: jid,
      context,
      chatType: isGroup ? 'group' : 'private',
      name: existing?.name || senderName || phone,
      phone,
      telegramId: null,
      lastMessage: text,
      lastMessageAt: new Date().toISOString(),
      unread: (existing?.unread || 0) + 1,
      role,
      roleSource,
    });
  } catch (err) {
    console.error(`[whatsapp:${userId}] به‌روزرسانی چت شکست خورد:`, err.message);
  }

  if (!extracted || !extracted.is_relevant) return; // not a lead

  await saveLead(userId, extracted, {
    source: 'whatsapp',
    chatId: jid,
    senderName,
    telegramId: null,
    phone,
    rawMessage: text,
    context,
  });

  console.log(
    `[whatsapp:${userId}] لید ${context} ذخیره شد (${extracted.role} / ${extracted.request_type}) از ${senderName || phone}`
  );
}

// A messenger-style preview for a WhatsApp message's content: the text if
// there is one, otherwise a short media placeholder (matches the Telegram inbox).
function waMessagePreview(message) {
  if (!message) return '';
  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
  if (message.imageMessage) return message.imageMessage.caption || '🖼 عکس';
  if (message.videoMessage) return message.videoMessage.caption || '🎬 ویدیو';
  if (message.audioMessage) return '🎤 پیام صوتی';
  if (message.stickerMessage) return '🈶 استیکر';
  if (message.documentMessage) return '📎 فایل';
  if (message.locationMessage) return '📍 موقعیت مکانی';
  if (message.contactMessage) return '👤 مخاطب';
  return '';
}

const tsToNumber = (ts) => Number(ts && ts.toNumber ? ts.toNumber() : ts) || 0;

/**
 * Mirrors WhatsApp's on-connect history batch into the inbox — one `chats` row
 * per conversation (name, last-message preview, time, unread, type), like the
 * Telegram sync. Skips status/broadcast/newsletter jids and never overwrites a
 * manual role. Does no AI calls, so it always works.
 */
async function handleHistorySync(userId, { chats = [], contacts = [], messages = [] } = {}) {
  if (!chats.length) return;

  const nameByJid = new Map();
  for (const c of contacts) {
    if (c?.id) nameByJid.set(c.id, c.name || c.notify || null);
  }
  // Latest message text per chat, from the history batch's messages.
  const lastByJid = new Map();
  for (const m of messages) {
    const jid = m?.key?.remoteJid;
    if (!jid) continue;
    const ts = tsToNumber(m.messageTimestamp);
    const prev = lastByJid.get(jid);
    if (!prev || ts >= prev.ts) lastByJid.set(jid, { ts, text: waMessagePreview(m.message) });
  }

  let count = 0;
  for (const chat of chats) {
    const jid = chat?.id;
    if (!jid) continue;
    const isGroup = jid.endsWith('@g.us');
    const isDirect = jid.endsWith('@s.whatsapp.net');
    if (!isGroup && !isDirect) continue; // skip status@broadcast / newsletter / etc.

    const phone = isDirect ? jid.split('@')[0].split(':')[0] : null;
    const name = chat.name || nameByJid.get(jid) || phone || jid;
    const last = lastByJid.get(jid);
    const tsNum = tsToNumber(chat.conversationTimestamp) || (last ? last.ts : 0);
    try {
      const existing = await getChat(userId, 'whatsapp', jid);
      await upsertChat(userId, {
        source: 'whatsapp',
        chatId: jid,
        context: isGroup ? 'group' : 'direct',
        chatType: isGroup ? 'group' : 'private',
        name,
        phone,
        telegramId: null,
        lastMessage: (last && last.text) || existing?.last_message || null,
        lastMessageAt: tsNum ? new Date(tsNum * 1000).toISOString() : existing?.last_message_at || null,
        unread:
          typeof chat.unreadCount === 'number' && chat.unreadCount > 0 ? chat.unreadCount : existing?.unread || 0,
        role: existing?.role || 'unknown',
        roleSource: existing?.role_source || 'ai',
      });
      count++;
    } catch (err) {
      console.warn(`[whatsapp:${userId}] ثبت چت واتساپ شکست خورد:`, err.message);
    }
  }
  console.log(`[whatsapp:${userId}] تاریخچه همگام شد: ${count} از ${chats.length} گفتگو ثبت شد.`);
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
