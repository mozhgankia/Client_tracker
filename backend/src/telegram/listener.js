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
'use strict';

const { TelegramClient } = require('teleproto');
const { StringSession } = require('teleproto/sessions');
const { NewMessage } = require('teleproto/events');

const { loadSessionString } = require('./sessionStore');
const { isLikelyRealEstateMessage } = require('./keywordFilter');
const { extractLeadFromMessage } = require('../ai/geminiExtract');
const { saveLead } = require('../db/leads');

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;

/**
 * Starts monitoring for one tenant. Call once per active tenant at server
 * startup (and again whenever a tenant connects Telegram from the dashboard).
 * @param {string} userId - the tenant's row id in `users`
 */
async function startTelegramListener(userId) {
  if (!apiId || !apiHash) {
    throw new Error('TELEGRAM_API_ID و TELEGRAM_API_HASH تنظیم نشده‌اند.');
  }

  const sessionString = await loadSessionString(userId);
  if (!sessionString) {
    console.warn(`[telegram] هیچ نشستی برای کاربر ${userId} پیدا نشد — ابتدا login.js را اجرا کنید.`);
    return null;
  }

  const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
    connectionRetries: 5,
  });
  await client.connect();

  client.addEventHandler(async (event) => {
    try {
      await handleNewMessage(userId, client, event);
    } catch (err) {
      // Never let one bad message kill the listener.
      console.error(`[telegram] خطا در پردازش پیام (کاربر ${userId}):`, err.message);
    }
  }, new NewMessage({}));

  console.log(`[telegram] شنود فعال شد برای کاربر ${userId}`);
  return client;
}

async function handleNewMessage(userId, client, event) {
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

module.exports = { startTelegramListener };
