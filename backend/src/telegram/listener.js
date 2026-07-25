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
 * classification) → saveLead. Returns 'saved' | 'dedup' | 'irrelevant'.
 */
async function processTelegramMessage(userId, { text, sender, chatId, isPrivate }) {
  const senderName = sender ? [sender.firstName, sender.lastName].filter(Boolean).join(' ').trim() : undefined;
  const telegramId = sender && sender.id != null ? String(sender.id) : undefined;
  const phone = sender && sender.phone ? sender.phone : null;

  // Skip anything we've already stored (so history sync never duplicates).
  if (await leadExists(userId, { source: 'telegram', telegramId, phone, rawMessage: text })) return 'dedup';

  const extracted = await extractLeadFromMessage(text, { senderName });
  if (!extracted.is_relevant) return 'irrelevant';

  // A private 1:1 chat is a personal lead; groups/channels are the A2A market.
  const context = isPrivate ? 'direct' : 'group';
  if (context === 'direct') {
    extracted.role = resolveRole(extracted, text, await getSettings(userId));
  }

  await saveLead(userId, extracted, {
    source: 'telegram',
    chatId: String(chatId),
    senderName: senderName || null,
    telegramId,
    phone,
    rawMessage: text,
    context,
  });
  return 'saved';
}

async function handleNewMessage(userId, event) {
  const message = event.message;
  if (message.out) return; // ignore our own outgoing messages
  const text = message.message;
  if (!text || !isLikelyRealEstateMessage(text)) return;
  const sender = message.sender || (await message.getSender().catch(() => null));
  const result = await processTelegramMessage(userId, {
    text,
    sender,
    chatId: message.chatId,
    isPrivate: message.isPrivate,
  });
  if (result === 'saved') console.log(`[telegram] لید زنده ذخیره شد (کاربر ${userId})`);
}

/**
 * Back-fills recent Telegram history through the same pipeline, and returns
 * detailed counts so we can see exactly where messages drop out. Bounded so it
 * never runs the AI thousands of times.
 * @returns {Promise<{dialogs:number, messages:number, candidates:number, saved:number, irrelevant:number, dedup:number, failed:number}>}
 */
async function syncTelegramHistory(userId, client, opts = {}) {
  const maxDialogs = opts.maxDialogs || 40;
  const perDialog = opts.perDialog || 60;
  const maxAiCalls = opts.maxAiCalls || 300;
  const stats = { dialogs: 0, messages: 0, candidates: 0, saved: 0, irrelevant: 0, dedup: 0, failed: 0 };

  let dialogs;
  try {
    dialogs = await client.getDialogs({ limit: maxDialogs });
  } catch (err) {
    console.error(`[telegram] getDialogs شکست خورد (کاربر ${userId}):`, err.message);
    throw err;
  }
  console.log(`[telegram] همگام‌سازی: ${dialogs.length} گفتگو یافت شد (کاربر ${userId})`);

  for (const dialog of dialogs) {
    if (stats.candidates >= maxAiCalls) break;
    stats.dialogs++;
    const isPrivate = Boolean(dialog.isUser);
    const target = dialog.entity || dialog.inputEntity || dialog.id;
    if (!target) continue;

    let messages;
    try {
      messages = await client.getMessages(target, { limit: perDialog });
    } catch (err) {
      console.warn(`[telegram] خواندن پیام‌های «${dialog.title || dialog.name || dialog.id}» شکست خورد:`, err.message);
      continue;
    }

    let candidatesHere = 0;
    for (const message of messages) {
      const text = message.message;
      if (!text || message.out) continue; // no text, or our own message
      stats.messages++;
      if (!isLikelyRealEstateMessage(text)) continue; // gate AI calls
      if (stats.candidates >= maxAiCalls) break;
      stats.candidates++;
      candidatesHere++;
      try {
        const sender = message.sender || (await message.getSender().catch(() => null));
        const result = await processTelegramMessage(userId, {
          text,
          sender,
          chatId: message.chatId ?? dialog.id,
          isPrivate,
        });
        stats[result] = (stats[result] || 0) + 1; // saved | dedup | irrelevant
      } catch (err) {
        stats.failed++;
      }
    }
    if (candidatesHere) {
      console.log(`[telegram] «${dialog.title || dialog.name || dialog.id}»: ${candidatesHere} پیام مرتبط`);
    }
  }

  console.log(
    `[telegram] همگام‌سازی تمام شد (کاربر ${userId}): ` +
      `${stats.dialogs} گفتگو، ${stats.messages} پیام، ${stats.candidates} مرتبط، ` +
      `${stats.saved} ذخیره، ${stats.irrelevant} نامرتبط، ${stats.dedup} تکراری`
  );
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
