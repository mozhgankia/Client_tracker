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
const { getChat, upsertChat } = require('../db/chats');
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

// Labels a chat's text as owner/client/unknown using the AI. Never throws —
// on any error (e.g. missing AI key) it returns 'unknown' so the chat is still
// shown, just unlabelled.
async function classifyRole(text, name) {
  if (!text) return 'unknown';
  try {
    const extracted = await extractLeadFromMessage(text, { senderName: name });
    return extracted.is_relevant && extracted.role ? extracted.role : 'unknown';
  } catch (err) {
    return 'unknown';
  }
}

function senderDisplayName(sender, fallback) {
  const n = sender ? [sender.firstName, sender.lastName].filter(Boolean).join(' ').trim() : '';
  return n || sender?.username || fallback;
}

// Upserts the inbox chat row for a Telegram message (all messages, not just
// real-estate ones), (re)labelling it unless the user set the label manually.
async function upsertTelegramChat(userId, { chatId, text, sender, isPrivate, name, at }) {
  const displayName = name || senderDisplayName(sender, String(chatId));
  const existing = await getChat(userId, 'telegram', chatId);
  let role = existing?.role || 'unknown';
  let roleSource = existing?.role_source || 'ai';
  const changed = !existing || existing.last_message !== text;
  if (text && changed && roleSource !== 'manual') {
    role = await classifyRole(text, displayName);
    roleSource = 'ai';
  }
  await upsertChat(userId, {
    source: 'telegram',
    chatId,
    context: isPrivate ? 'direct' : 'group',
    name: displayName,
    phone: sender?.phone ? `+${sender.phone}` : existing?.phone || null,
    telegramId: sender?.id != null ? String(sender.id) : existing?.telegram_id || null,
    lastMessage: text || existing?.last_message || null,
    lastMessageAt: at || new Date().toISOString(),
    role,
    roleSource,
  });
}

async function handleNewMessage(userId, event) {
  const message = event.message;
  if (message.out) return; // ignore our own outgoing messages
  const text = message.message;
  const sender = message.sender || (await message.getSender().catch(() => null));

  // Inbox: keep the chat's last message + label fresh for every message.
  await upsertTelegramChat(userId, {
    chatId: message.chatId,
    text,
    sender,
    isPrivate: message.isPrivate,
    at: message.date ? new Date(message.date * 1000).toISOString() : undefined,
  }).catch((err) => console.error(`[telegram] به‌روزرسانی چت شکست خورد:`, err.message));

  // Leads / A2A: only real-estate messages feed the leads page + A2A board.
  if (text && isLikelyRealEstateMessage(text)) {
    await processTelegramMessage(userId, { text, sender, chatId: message.chatId, isPrivate: message.isPrivate }).catch(
      (err) => console.error(`[telegram] پردازش لید شکست خورد:`, err.message)
    );
  }
}

/**
 * Mirrors the account's Telegram chat list into the inbox: one `chats` row per
 * dialog (ALL chats, not just real-estate ones), each labelled owner/client/
 * unknown by the AI. Also feeds the recent real-estate messages of each dialog
 * into the leads/A2A pipeline. Never hides a chat for lacking keywords.
 * @returns {Promise<{dialogs:number, chats:number, labeled:number, leads:number, failed:number}>}
 */
async function syncTelegramHistory(userId, client, opts = {}) {
  const maxDialogs = opts.maxDialogs || 60;
  const perDialog = opts.perDialog || 40;
  const maxLeadCalls = opts.maxLeadCalls || 200;
  const stats = { dialogs: 0, chats: 0, labeled: 0, leads: 0, failed: 0 };

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
    const isPrivate = Boolean(dialog.isUser);
    const chatId = String(dialog.id);
    const entity = dialog.entity;
    const name =
      dialog.title ||
      dialog.name ||
      senderDisplayName(entity, chatId);
    const lastMsg = dialog.message?.message || '';
    const lastAt = dialog.message?.date ? new Date(dialog.message.date * 1000).toISOString() : null;

    // 1) Always record the chat itself (so the inbox mirrors Telegram).
    try {
      const existing = await getChat(userId, 'telegram', chatId);
      let role = existing?.role || 'unknown';
      let roleSource = existing?.role_source || 'ai';
      const changed = !existing || existing.last_message !== lastMsg;
      if (lastMsg && changed && roleSource !== 'manual') {
        role = await classifyRole(lastMsg, name);
        roleSource = 'ai';
        stats.labeled++;
      }
      await upsertChat(userId, {
        source: 'telegram',
        chatId,
        context: isPrivate ? 'direct' : 'group',
        name,
        phone: entity?.phone ? `+${entity.phone}` : null,
        telegramId: entity?.id != null ? String(entity.id) : null,
        lastMessage: lastMsg,
        lastMessageAt: lastAt,
        role,
        roleSource,
      });
      stats.chats++;
    } catch (err) {
      stats.failed++;
      console.warn(`[telegram] ثبت چت «${name}» شکست خورد:`, err.message);
    }

    // 2) Feed recent real-estate messages of this dialog into leads/A2A.
    if (stats.leads < maxLeadCalls) {
      let messages;
      try {
        messages = await client.getMessages(entity || dialog.inputEntity || dialog.id, { limit: perDialog });
      } catch (err) {
        continue;
      }
      for (const message of messages) {
        const text = message.message;
        if (!text || message.out || !isLikelyRealEstateMessage(text)) continue;
        if (stats.leads >= maxLeadCalls) break;
        try {
          const sender = message.sender || (await message.getSender().catch(() => null));
          const result = await processTelegramMessage(userId, { text, sender, chatId: message.chatId ?? dialog.id, isPrivate });
          if (result === 'saved') stats.leads++;
        } catch (err) {
          /* skip one bad message */
        }
      }
    }
  }

  console.log(
    `[telegram] همگام‌سازی تمام شد (کاربر ${userId}): ` +
      `${stats.dialogs} گفتگو، ${stats.chats} چت ثبت شد، ${stats.labeled} برچسب، ${stats.leads} لید`
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
