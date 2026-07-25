// Live monitor for a tenant's Telegram account: watches the groups/channels
// they're already a member of (real estate groups, developer channels) using
// their own account via an MTProto client — not a bot, since bots can't read
// messages in channels/groups they weren't explicitly given admin rights to,
// and can't be added to arbitrary existing groups the way a personal account
// monitoring pattern requires.
//
// Uses `teleproto`, not the original `telegram` (GramJS) package — GramJS is
// now archived/unmaintained upstream, and teleproto is the actively
// maintained, API-compatible fork the GramJS maintainers point to.
//
// For a *bot*-based flow instead (simpler, but limited to chats that message
// the bot directly, or groups where the bot is an admin), see botListener.js.
// For the phone-number/code/2FA login handshake itself, see authFlow.js —
// this module only ever starts a listener from an *already saved* session.
'use strict';

const { TelegramClient, Api } = require('teleproto');
const { StringSession } = require('teleproto/sessions');
const { NewMessage } = require('teleproto/events');

const { loadSessionString, deleteSessionString } = require('./sessionStore');
const { isLikelyRealEstateMessage } = require('../shared/keywordFilter');
const { extractLeadFromMessage } = require('../ai/geminiExtract');
const { saveLead, leadExists } = require('../db/leads');
const { getSettings } = require('../db/settings');
const { resolveRole } = require('../classify/classifier');

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;

// One entry per connected tenant: { client, status, phone, username }
// status: 'connected' | 'disconnected'
const connections = new Map();

function getConnectionInfo(userId) {
  const entry = connections.get(userId);
  if (!entry) return { status: 'disconnected' };
  return { status: entry.status, phone: entry.phone || null, username: entry.username || null };
}

/**
 * Starts monitoring for one tenant from their already-saved session. Call
 * once per active tenant at server startup, and again right after
 * authFlow.js finishes a fresh login (so it doesn't wait for a restart).
 * @param {string} userId - the tenant's row id in `users`
 */
async function startTelegramListener(userId) {
  if (!apiId || !apiHash) {
    throw new Error('TELEGRAM_API_ID و TELEGRAM_API_HASH تنظیم نشده‌اند.');
  }
  const existing = connections.get(userId);
  if (existing?.status === 'connected') return existing;

  const sessionString = await loadSessionString(userId);
  if (!sessionString) {
    console.warn(`[telegram] هیچ نشستی برای کاربر ${userId} پیدا نشد — باید از داشبورد وصل بشه.`);
    return null;
  }

  const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
    connectionRetries: 5,
  });
  await client.connect();

  const me = await client.getMe();
  const entry = {
    client,
    status: 'connected',
    phone: me.phone ? `+${me.phone}` : null,
    username: me.username || null,
  };
  connections.set(userId, entry);

  client.addEventHandler(async (event) => {
    try {
      await handleNewMessage(userId, event);
    } catch (err) {
      // Never let one bad message kill the listener.
      console.error(`[telegram] خطا در پردازش پیام (کاربر ${userId}):`, err.message);
    }
  }, new NewMessage({}));

  console.log(`[telegram] شنود فعال شد برای کاربر ${userId} (${entry.phone || entry.username})`);

  // Back-fill recent history in the background so previously-received chats
  // show up too (the live NewMessage handler only catches messages from now
  // on). Deduped, so re-running on every restart is cheap.
  syncTelegramHistory(userId, client).catch((err) =>
    console.error(`[telegram] همگام‌سازی تاریخچه شکست خورد (کاربر ${userId}):`, err.message)
  );

  return entry;
}

/**
 * Shared message → lead pipeline for both the live handler and the history
 * sync: keyword pre-filter → dedup → AI extraction → (personal-only keyword
 * classification) → saveLead. Returns true if a new lead was stored.
 */
async function processTelegramMessage(userId, { text, sender, chatId, isPrivate }) {
  if (!isLikelyRealEstateMessage(text)) return false; // cheap filter before any AI/DB work

  const senderName = sender ? [sender.firstName, sender.lastName].filter(Boolean).join(' ') : undefined;
  const telegramId = sender && sender.id ? String(sender.id) : undefined;
  const phone = sender && sender.phone ? sender.phone : null;

  // Skip anything we've already stored (so history sync never duplicates).
  if (await leadExists(userId, { source: 'telegram', telegramId, phone, rawMessage: text })) return false;

  const extracted = await extractLeadFromMessage(text, { senderName });
  if (!extracted.is_relevant) return false;

  // A private 1:1 chat is a personal lead; groups/channels are the A2A market.
  const context = isPrivate ? 'direct' : 'group';
  if (context === 'direct') {
    extracted.role = resolveRole(extracted, text, await getSettings(userId));
  }

  await saveLead(userId, extracted, {
    source: 'telegram',
    chatId: String(chatId),
    senderName,
    telegramId,
    phone,
    rawMessage: text,
    context,
  });
  return true;
}

async function handleNewMessage(userId, event) {
  const message = event.message;
  const sender = await message.getSender().catch(() => null);
  const saved = await processTelegramMessage(userId, {
    text: message.message,
    sender,
    chatId: message.chatId,
    isPrivate: message.isPrivate,
  });
  if (saved) console.log(`[telegram] لید زنده ذخیره شد (کاربر ${userId})`);
}

/**
 * Back-fills recent Telegram history through the same pipeline. Bounded so it
 * can't run the AI thousands of times: scans the most recent dialogs and their
 * recent messages, and stops after MAX_AI_CALLS keyword-matching messages.
 * @returns {Promise<{scanned:number, saved:number}>}
 */
async function syncTelegramHistory(userId, client, opts = {}) {
  const maxDialogs = opts.maxDialogs || 30;
  const perDialog = opts.perDialog || 40;
  const maxAiCalls = opts.maxAiCalls || 250;
  const stats = { scanned: 0, saved: 0 };

  const dialogs = await client.getDialogs({ limit: maxDialogs });
  for (const dialog of dialogs) {
    if (stats.scanned >= maxAiCalls) break;
    const isPrivate = Boolean(dialog.isUser);
    let messages;
    try {
      messages = await client.getMessages(dialog.entity || dialog.inputEntity, { limit: perDialog });
    } catch (err) {
      continue; // skip dialogs we can't read
    }
    for (const message of messages) {
      const text = message.message;
      if (!text || stats.scanned >= maxAiCalls) continue;
      if (!isLikelyRealEstateMessage(text)) continue; // gate AI calls
      stats.scanned++;
      try {
        const sender = await message.getSender().catch(() => null);
        const saved = await processTelegramMessage(userId, {
          text,
          sender,
          chatId: message.chatId ?? dialog.id,
          isPrivate,
        });
        if (saved) stats.saved++;
      } catch (err) {
        // one bad message shouldn't abort the whole sync
      }
    }
  }
  console.log(`[telegram] همگام‌سازی تمام شد (کاربر ${userId}): ${stats.saved} لید از ${stats.scanned} پیام مرتبط`);
  return stats;
}

/** Triggers a history sync on demand for a connected tenant (dashboard button). */
async function syncNow(userId) {
  const entry = connections.get(userId);
  if (!entry || entry.status !== 'connected' || !entry.client) {
    throw new Error('تلگرام متصل نیست — ابتدا از تب اتصالات وصل شوید.');
  }
  return syncTelegramHistory(userId, entry.client);
}

/** Logs the tenant's Telegram account out entirely (dashboard's "Disconnect"
 * button) — unlike a plain socket close, this revokes the saved session so
 * reconnecting requires a fresh phone/code/2FA login. */
async function disconnectTelegram(userId) {
  const entry = connections.get(userId);
  if (entry?.client) {
    await entry.client.invoke(new Api.auth.LogOut()).catch(() => {});
    await entry.client.disconnect().catch(() => {});
  }
  connections.delete(userId);
  await deleteSessionString(userId);
}

module.exports = { startTelegramListener, getConnectionInfo, disconnectTelegram, syncNow };
