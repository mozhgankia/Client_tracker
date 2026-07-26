// Live monitor for a tenant's Telegram account: watches the groups/channels
// and private chats they're already part of, using their own account via an
// MTProto client — not a bot, since bots can't read a user's existing personal
// chats/groups, and can't be added to arbitrary existing groups the way a
// personal-account monitoring pattern requires.
//
// Uses `teleproto`, not the original `telegram` (GramJS) package — GramJS is
// now archived/unmaintained upstream, and teleproto is the actively
// maintained, API-compatible fork the GramJS maintainers point to.
//
// PHASE 1 (clean inbox, like Web Telegram / WhatsApp):
//   The sync mirrors the account's real chat list into the `chats` table with
//   real details (name, last message, time, unread count, chat type) and
//   filters out noise — the Telegram service account that sends login codes
//   (777000), the user's own Saved Messages, deleted accounts, and empty
//   service chats. The sync itself does NO AI calls, so it always works even
//   without an AI key; chats start unlabeled and the user marks them by hand
//   (stable manual marks). The live handler still feeds real-estate messages
//   into the leads pipeline as before.
'use strict';

const { TelegramClient, Api } = require('teleproto');
const { StringSession } = require('teleproto/sessions');
const { NewMessage } = require('teleproto/events');

const { loadSessionString, deleteSessionString } = require('./sessionStore');
const { isLikelyRealEstateMessage } = require('../shared/keywordFilter');
const { extractLeadFromMessage } = require('../ai/geminiExtract');
const { saveLead, leadExists } = require('../db/leads');
const { getChat, upsertChat } = require('../db/chats');
const { getSettings } = require('../db/settings');
const { resolveRole } = require('../classify/classifier');

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;

// Telegram's own service/notification accounts. 777000 is the one that sends
// login codes ("Your login code is …") — it must never appear in the inbox.
const TELEGRAM_SERVICE_IDS = new Set(['777000', '42777']);

// One entry per connected tenant: { client, status, phone, username, meId }
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
    meId: me.id != null ? String(me.id) : null,
  };
  connections.set(userId, entry);

  client.addEventHandler(async (event) => {
    try {
      await handleNewMessage(userId, event, entry);
    } catch (err) {
      // Never let one bad message kill the listener.
      console.error(`[telegram] خطا در پردازش پیام (کاربر ${userId}):`, err.message);
    }
  }, new NewMessage({}));

  console.log(`[telegram] شنود فعال شد برای کاربر ${userId} (${entry.phone || entry.username})`);

  // Back-fill the chat list in the background so previously-received chats
  // show up too (the live NewMessage handler only catches messages from now
  // on). Upserted by (user, source, chat_id), so re-running is cheap.
  syncTelegramHistory(userId, client, { meId: entry.meId }).catch((err) =>
    console.error(`[telegram] همگام‌سازی تاریخچه شکست خورد (کاربر ${userId}):`, err.message)
  );

  return entry;
}

/**
 * Shared message → lead pipeline for the live handler: dedup → AI extraction →
 * (personal-only keyword classification) → saveLead. Returns 'saved' |
 * 'dedup' | 'irrelevant'.
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

function senderDisplayName(sender, fallback) {
  const n = sender ? [sender.firstName, sender.lastName].filter(Boolean).join(' ').trim() : '';
  return n || sender?.username || fallback;
}

// A messenger-style preview for a chat's last message: the text if there is
// one, otherwise a short media placeholder (like WhatsApp/Telegram show).
function lastMessagePreview(message) {
  if (!message) return '';
  const text = message.message || '';
  if (text) return text;
  if (message.photo) return '🖼 عکس';
  if (message.video) return '🎬 ویدیو';
  if (message.voice || message.audio) return '🎤 پیام صوتی';
  if (message.sticker) return '🈶 استیکر';
  if (message.document) return '📎 فایل';
  if (message.geo || message.venue) return '📍 موقعیت مکانی';
  if (message.contact) return '👤 مخاطب';
  if (message.media) return '📎 پیوست';
  return '';
}

// private (1:1 user) | group (basic group or megagroup) | channel (broadcast)
function dialogChatType(dialog) {
  if (dialog.isUser) return 'private';
  if (dialog.isGroup) return 'group';
  if (dialog.isChannel) return 'channel';
  return 'group';
}

// Decides whether a dialog is noise that must never reach the inbox: Telegram's
// service/login-code accounts, the user's own Saved Messages, or a chat whose
// counterpart is a deleted account.
function isNoiseDialog(dialog, entity, meId) {
  const idStr = String(dialog.id).replace('-100', '').replace('-', '');
  const entIdStr = entity?.id != null ? String(entity.id) : null;
  if (TELEGRAM_SERVICE_IDS.has(idStr) || (entIdStr && TELEGRAM_SERVICE_IDS.has(entIdStr))) return true;
  if (meId && (idStr === meId || entIdStr === meId)) return true; // Saved Messages / self
  if (entity?.self) return true;
  if (entity?.deleted) return true; // deleted user account
  return false;
}

// A chat id string is a service/self chat we must ignore on the live path too.
function isNoiseChatId(chatId, meId) {
  if (chatId == null) return false;
  const idStr = String(chatId).replace('-100', '').replace('-', '');
  if (TELEGRAM_SERVICE_IDS.has(idStr)) return true;
  if (meId && idStr === meId) return true;
  return false;
}

async function handleNewMessage(userId, event, entry) {
  const message = event.message;
  if (message.out) return; // ignore our own outgoing messages
  const meId = entry?.meId || null;
  if (isNoiseChatId(message.chatId, meId)) return; // login codes / Saved Messages

  const text = message.message;
  const sender = message.sender || (await message.getSender().catch(() => null));
  const preview = lastMessagePreview(message);

  // Inbox: keep the chat's last message + unread fresh for every message,
  // without any AI call (labels stay stable — see file header).
  try {
    const chatId = String(message.chatId);
    const existing = await getChat(userId, 'telegram', chatId);
    const chatType = message.isPrivate ? 'private' : message.isChannel && !message.isGroup ? 'channel' : 'group';
    const displayName =
      existing?.name || senderDisplayName(sender, chatId);
    await upsertChat(userId, {
      source: 'telegram',
      chatId,
      context: message.isPrivate ? 'direct' : 'group',
      chatType,
      name: displayName,
      phone: sender?.phone ? `+${sender.phone}` : existing?.phone || null,
      telegramId: sender?.id != null ? String(sender.id) : existing?.telegram_id || null,
      lastMessage: preview || existing?.last_message || null,
      lastMessageAt: message.date ? new Date(message.date * 1000).toISOString() : new Date().toISOString(),
      unread: (existing?.unread || 0) + 1,
      role: existing?.role || 'unknown',
      roleSource: existing?.role_source || 'ai',
    });
  } catch (err) {
    console.error(`[telegram] به‌روزرسانی چت شکست خورد:`, err.message);
  }

  // Leads / A2A: only real-estate messages feed the leads page + A2A board.
  if (text && isLikelyRealEstateMessage(text)) {
    await processTelegramMessage(userId, { text, sender, chatId: message.chatId, isPrivate: message.isPrivate }).catch(
      (err) => console.error(`[telegram] پردازش لید شکست خورد:`, err.message)
    );
  }
}

/**
 * Mirrors the account's Telegram chat list into the inbox — one `chats` row per
 * real conversation, like Web Telegram's chat list. Filters out noise (login-
 * code service account 777000, the user's own Saved Messages, deleted accounts,
 * and empty service chats) and records real details: name, last-message
 * preview (with media placeholders), time, unread count, and chat type
 * (private/group/channel). Does NO AI calls, so it always works and never
 * overwrites a manual label — existing roles are preserved, new chats start
 * 'unknown' for the user to mark by hand.
 * @returns {Promise<{dialogs:number, chats:number, skipped:number, failed:number}>}
 */
async function syncTelegramHistory(userId, client, opts = {}) {
  const maxDialogs = opts.maxDialogs || 200;
  let meId = opts.meId || null;
  if (!meId) {
    try {
      const me = await client.getMe();
      meId = me?.id != null ? String(me.id) : null;
    } catch (_err) {
      /* fall through with meId = null */
    }
  }
  const stats = { dialogs: 0, chats: 0, skipped: 0, failed: 0 };

  let dialogs;
  try {
    dialogs = await client.getDialogs({ limit: maxDialogs });
  } catch (err) {
    console.error(`[telegram] getDialogs شکست خورد (کاربر ${userId}):`, err.message);
    throw err;
  }
  console.log(`[telegram] همگام‌سازی: ${dialogs.length} گفتگو یافت شد (کاربر ${userId})`);

  for (const dialog of dialogs) {
    stats.dialogs++;
    const entity = dialog.entity;
    const chatId = String(dialog.id);

    // 1) Drop noise (login codes, Saved Messages, deleted accounts).
    if (isNoiseDialog(dialog, entity, meId)) {
      stats.skipped++;
      continue;
    }

    const chatType = dialogChatType(dialog);
    const name = dialog.title || dialog.name || senderDisplayName(entity, chatId);
    const preview = lastMessagePreview(dialog.message);
    const lastAt = dialog.message?.date ? new Date(dialog.message.date * 1000).toISOString() : null;

    // 2) Drop truly empty chats (no message at all — service/placeholder rows).
    if (!preview && !lastAt) {
      stats.skipped++;
      continue;
    }

    try {
      const existing = await getChat(userId, 'telegram', chatId);
      await upsertChat(userId, {
        source: 'telegram',
        chatId,
        context: chatType === 'private' ? 'direct' : 'group',
        chatType,
        name,
        phone: entity?.phone ? `+${entity.phone}` : existing?.phone || null,
        telegramId: entity?.id != null ? String(entity.id) : existing?.telegram_id || null,
        lastMessage: preview || existing?.last_message || null,
        lastMessageAt: lastAt || existing?.last_message_at || null,
        unread: typeof dialog.unreadCount === 'number' ? dialog.unreadCount : 0,
        // Never relabel here: keep the user's manual mark, or the existing one,
        // or start fresh at 'unknown'. Sync does no AI classification.
        role: existing?.role || 'unknown',
        roleSource: existing?.role_source || 'ai',
      });
      stats.chats++;
    } catch (err) {
      stats.failed++;
      console.warn(`[telegram] ثبت چت «${name}» شکست خورد:`, err.message);
    }
  }

  console.log(
    `[telegram] همگام‌سازی تمام شد (کاربر ${userId}): ` +
      `${stats.dialogs} گفتگو، ${stats.chats} چت ثبت شد، ${stats.skipped} نادیده، ${stats.failed} خطا`
  );
  return stats;
}

/** Triggers a chat-list sync on demand for a connected tenant (dashboard button). */
async function syncNow(userId) {
  const entry = connections.get(userId);
  if (!entry || entry.status !== 'connected' || !entry.client) {
    throw new Error('تلگرام متصل نیست — ابتدا از تب اتصالات وصل شوید.');
  }
  return syncTelegramHistory(userId, entry.client, { meId: entry.meId });
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
