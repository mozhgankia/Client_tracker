// Optional AI layer for the Real-Estate Engine — "smart" usage.
//
// The deterministic engine (realEstateEngine.js) always runs and is enough on
// its own. Gemini is called only when it actually adds value AND a key is
// configured, so the per-message cost stays near zero:
//   * the message is real-estate relevant, AND
//   * either the deterministic label is not yet confident (needs a tie-breaker)
//     or the message is high-value (mentions a price) and worth a precise read.
// Gemini's answer is folded back in as ONE extra strong signal (a vote), never
// as an override — so a single odd AI read can't hijack an established profile.
'use strict';

const { extractLeadFromMessage } = require('../ai/geminiExtract');
const { LOCK_CONF } = require('./realEstateEngine');

function aiEnabled() {
  return Boolean(process.env.GOOGLE_AI_API_KEY);
}

/**
 * @param {object} msg      result of scoreMessage()
 * @param {number} confidence  the deterministic confidence so far (0..100)
 * @returns {boolean}
 */
function shouldUseAI(msg, confidence) {
  if (!aiEnabled() || !msg || !msg.relevant) return false;
  const ambiguous = (confidence || 0) < LOCK_CONF;
  const highValue = Boolean(msg.extracted && msg.extracted.price);
  return ambiguous || highValue;
}

/**
 * Returns { aiRole, extracted } from Gemini, or null on any error/skip. Never
 * throws — the engine must keep working if the AI call fails.
 */
async function aiVote(text, senderName) {
  try {
    const ex = await extractLeadFromMessage(text, { senderName });
    if (!ex || !ex.is_relevant) return null;
    const aiRole = ex.role === 'owner' || ex.role === 'client' ? ex.role : null;
    const extracted = {
      region: ex.region || null,
      bedrooms: ex.bedrooms != null ? ex.bedrooms : null,
      area_sqft: ex.area_sqft != null ? ex.area_sqft : null,
      price: ex.listed_price != null ? ex.listed_price : null,
      request_type:
        ex.request_type && ex.request_type !== 'unknown' ? ex.request_type : null,
    };
    return { aiRole, extracted };
  } catch (_err) {
    return null;
  }
}

module.exports = { shouldUseAI, aiVote, aiEnabled };
