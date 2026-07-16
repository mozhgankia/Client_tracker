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
const { saveLead } = require('../db/leads');

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
  return entry;
}

async function handleNewMessage(userId, event) {
  const message = event.message;
  const text = message.message;
  if (!isLikelyRealEstateMessage(text)) return; // cheap filter — skip AI call entirely

  const sender = await message.getSender().catch(() => null);
  const senderName = sender ? [sender.firstName, sender.lastName].filter(Boolean).join(' ') : undefined;
  const telegramId = sender && sender.id ? String(sender.id) : undefined;

  const extracted = await extractLeadFromMessage(text, { senderName });
  if (!extracted.is_relevant) return;

  await saveLead(userId, extracted, {
    source: 'telegram',
    chatId: String(message.chatId),
    senderName,
    telegramId,
    phone: sender && sender.phone ? sender.phone : null,
    rawMessage: text,
  });

  console.log(`[telegram] لید تازه ذخیره شد (${extracted.role} / ${extracted.request_type}) از ${senderName || telegramId}`);
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

module.exports = { startTelegramListener, getConnectionInfo, disconnectTelegram };
