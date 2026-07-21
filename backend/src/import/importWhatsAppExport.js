// Runs an exported WhatsApp chat through the SAME pipeline as live messages:
//   keyword pre-filter  ->  Gemini extraction  ->  saveLead
// so old conversations produce the same review-ready leads that new ones do.
// This is the batch/back-fill counterpart to whatsapp/connection.js's live
// handleIncomingMessage.
'use strict';

const { isLikelyRealEstateMessage } = require('../shared/keywordFilter');
const { extractLeadFromMessage } = require('../ai/geminiExtract');
const { saveLead } = require('../db/leads');
const { getSettings } = require('../db/settings');
const { resolveRole } = require('../classify/classifier');
const { parseWhatsAppExport } = require('./whatsappExportParser');

// A sender that is a bare phone number (common when the contact isn't saved).
const PHONE_RE = /^\+?[\d][\d\s\-()]{6,}$/;

// Safety cap: one HTTP request shouldn't run the AI thousands of times (it
// would blow the request timeout and the Gemini free-tier quota). Anything
// past this is reported as `truncated` so the user can split the file.
const MAX_AI_CALLS = 600;

// How many Gemini calls to keep in flight. Low enough to stay under the free
// tier's per-minute limit, high enough that a few hundred messages finish in
// a reasonable time.
const CONCURRENCY = 3;

/**
 * @param {string} userId  tenant id (from the verified JWT — never the body)
 * @param {string} content raw .txt export contents
 * @param {{ chatLabel?: string }} [opts]
 * @returns {Promise<object>} summary stats for the dashboard to display
 */
async function importWhatsAppExport(userId, content, opts = {}) {
  const chatLabel = opts.chatLabel || 'import';
  // Fetch the tenant's classifier keywords once for the whole import (rather
  // than per message) so unknown-role leads still get bucketed by keyword.
  const settings = await getSettings(userId);
  const messages = parseWhatsAppExport(content);
  const candidates = messages.filter((m) => isLikelyRealEstateMessage(m.text));
  const capped = candidates.slice(0, MAX_AI_CALLS);

  const stats = {
    totalMessages: messages.length,
    candidates: candidates.length,
    processed: 0,
    leadsSaved: 0,
    irrelevant: 0,
    failed: 0,
    truncated: candidates.length > capped.length,
  };

  let cursor = 0;
  async function worker() {
    while (cursor < capped.length) {
      const m = capped[cursor++];
      stats.processed++;
      try {
        const extracted = await extractLeadFromMessage(m.text, { senderName: m.sender });
        if (!extracted.is_relevant) {
          stats.irrelevant++;
          continue;
        }
        // Let the tenant's editable keywords break ties the AI left as unknown.
        extracted.role = resolveRole(extracted, m.text, settings);
        const isPhone = PHONE_RE.test(m.sender);
        await saveLead(userId, extracted, {
          source: 'whatsapp',
          chatId: chatLabel,
          senderName: isPhone ? null : m.sender,
          telegramId: null,
          phone: isPhone ? m.sender.replace(/[\s\-()]/g, '') : null,
          rawMessage: m.text,
        });
        stats.leadsSaved++;
      } catch (err) {
        // One bad message (AI error, rate limit, malformed row) must not abort
        // the whole import — count it and move on.
        stats.failed++;
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  return stats;
}

module.exports = { importWhatsAppExport };
