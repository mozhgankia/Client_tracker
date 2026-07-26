// Bridge between the Real-Estate Engine and the inbox `chats` table, shared by
// the Telegram and WhatsApp live handlers so both classify identically.
'use strict';

const { getChat, upsertChat } = require('../db/chats');
const { scoreMessage, updateProfile } = require('./realEstateEngine');
const { shouldUseAI, aiVote } = require('./aiLayer');

// Fold non-null AI-extracted values into a message's extracted values.
function withAiExtracted(msg, aiExtracted) {
  if (!aiExtracted) return msg;
  const extracted = { ...msg.extracted };
  for (const [k, v] of Object.entries(aiExtracted)) {
    if (v != null && v !== '') extracted[k] = v;
  }
  return { ...msg, extracted };
}

/**
 * Runs the Real-Estate Engine for one incoming message and upserts the chat's
 * classification (role, confidence, needs-review, signals, extracted values).
 * The user's manual mark is always preserved. Gemini is consulted only when the
 * smart gate says it helps (ambiguous or high-value) and a key is configured.
 * @param {string} userId
 * @param {'telegram'|'whatsapp'} source
 * @param {object} chat  { chatId, text, chatType, name, phone, telegramId,
 *   lastMessage, lastMessageAt, unread, senderName }
 * @returns {Promise<object>} the engine result (role, confidence, …)
 */
async function classifyAndUpsertChat(userId, source, chat) {
  const {
    chatId, text, chatType, name, phone, telegramId, lastMessage, lastMessageAt, unread, senderName,
  } = chat;
  const existing = (await getChat(userId, source, chatId)) || {};
  const manual = existing.role_source === 'manual';

  let msg = scoreMessage(text || '', { chatType });
  let aiRole = null;
  if (!manual && text) {
    const provisional = updateProfile(existing, msg, {}); // deterministic-only, gates AI
    if (shouldUseAI(msg, provisional.confidence)) {
      const vote = await aiVote(text, senderName);
      if (vote) {
        aiRole = vote.aiRole;
        msg = withAiExtracted(msg, vote.extracted);
      }
    }
  }

  const res = updateProfile(existing, msg, { manual, aiRole });
  await upsertChat(userId, {
    source,
    chatId,
    context: chatType === 'private' ? 'direct' : 'group',
    chatType,
    name,
    phone,
    telegramId,
    lastMessage,
    lastMessageAt,
    unread,
    role: res.role,
    roleSource: res.roleSource,
    signals: res.signals,
    confidence: res.confidence,
    needsReview: res.needsReview,
    extracted: res.extracted,
  });
  return res;
}

module.exports = { classifyAndUpsertChat };
