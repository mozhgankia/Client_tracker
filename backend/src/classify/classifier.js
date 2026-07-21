// Deterministic, no-cost classifier: decides owner vs client from a message
// using the tenant's editable keyword lists. Runs before (and cheaper than)
// any AI call. Returns 'unknown' when the text gives no clear signal, leaving
// those cases for the AI-suggestion step the user can accept or reject.
'use strict';

function countMatches(text, keywords) {
  const hay = String(text || '').toLowerCase();
  const matched = [];
  for (const kw of keywords || []) {
    const needle = String(kw).toLowerCase().trim();
    if (needle && hay.includes(needle)) matched.push(kw);
  }
  return matched;
}

/**
 * @param {string} text  the message text
 * @param {{ owner_keywords: string[], client_keywords: string[] }} settings
 * @returns {{ role: 'owner'|'client'|'unknown', matched: string[] }}
 */
function classifyByKeywords(text, settings = {}) {
  const ownerHits = countMatches(text, settings.owner_keywords);
  const clientHits = countMatches(text, settings.client_keywords);

  if (ownerHits.length > clientHits.length) return { role: 'owner', matched: ownerHits };
  if (clientHits.length > ownerHits.length) return { role: 'client', matched: clientHits };
  // A tie (including 0–0) is genuinely ambiguous.
  return { role: 'unknown', matched: [...ownerHits, ...clientHits] };
}

/**
 * Combines the AI's extracted role with the keyword classifier: trust the AI
 * when it is confident (owner/client), otherwise let the tenant's keywords
 * break the tie. Used on the live + import ingest paths so leads land in the
 * right bucket automatically.
 * @param {{ role?: string }} extracted  the Gemini-extracted lead
 * @param {string} text
 * @param {object} settings
 * @returns {'owner'|'client'|'unknown'}
 */
function resolveRole(extracted, text, settings) {
  if (extracted && (extracted.role === 'owner' || extracted.role === 'client')) {
    return extracted.role;
  }
  return classifyByKeywords(text, settings).role;
}

module.exports = { classifyByKeywords, resolveRole };
