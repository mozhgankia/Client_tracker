// Real-Estate AI Engine — the intelligent, multi-signal classifier.
//
// Two deterministic layers (no network, no AI key required):
//   1) scoreMessage(text, {chatType})  — reads ONE message and produces weighted
//      directional signals (client / owner / colleague) plus extracted values
//      (region, price, sqft, bedrooms, request type, residential/commercial).
//   2) updateProfile(prev, msg)        — folds a message's signals into a
//      contact's rolling "intent profile", then decides a STABLE label with a
//      confidence score, hysteresis (established labels don't flip on weak
//      evidence), a "needs review" flag for low confidence, and an absolute
//      lock on any manual mark the user made.
//
// A third, optional AI layer (see aiLayer.js) can fold Gemini's structured
// read in as one extra strong signal on ambiguous/high-value messages — but the
// engine is fully functional without it, so classification never breaks when
// the AI key is missing.
'use strict';

const STRONG = 3;
const MED = 2;
const WEAK = 1;

// Confidence at/above which a label is considered locked-in (shown in a clean
// category folder); below it the chat is flagged "needs review" instead of
// silently landing a possibly-wrong contact in a main folder.
const LOCK_CONF = 65;
// A new leading category must beat the established one by this margin before the
// label flips — this is the hysteresis that stops labels oscillating.
const FLIP_MARGIN = 3;
// Per real-estate message seen in a group/channel, nudge toward "colleague"
// (agent-to-agent market), since groups are the A2A space, not personal chats.
const GROUP_COLLEAGUE_BIAS = 1.5;

// Normalize Persian/Arabic text so matching is robust: drop ZWNJ, unify
// Arabic Yeh/Kaf to Persian, convert Arabic-Indic & Persian digits to Latin,
// lowercase, collapse whitespace.
function normalize(s) {
  return String(s || '')
    .replace(/‌/g, ' ')
    .replace(/ي/g, 'ی') // ي -> ی
    .replace(/ك/g, 'ک') // ك -> ک
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// term list per category; each term is normalized once at load. ASCII terms are
// matched on word boundaries (so "br" doesn't match inside "library"); non-ASCII
// (Persian/Arabic) terms use substring matching (word boundaries don't apply).
const RAW_SIGNALS = {
  client: [
    // strong — explicit seeking
    ['دنبال', STRONG], ['میخوام بخرم', STRONG], ['میخواهم بخرم', STRONG], ['نیاز دارم', STRONG],
    ['متقاضی', STRONG], ['خریدارم', STRONG], ['مستاجرم', STRONG], ['اجاره میخوام', STRONG],
    ['اجاره میخواهم', STRONG], ['دنبال خرید', STRONG], ['دنبال اجاره', STRONG],
    ['looking for', STRONG], ['want to buy', STRONG], ['want to rent', STRONG], ['i need', STRONG],
    ['searching for', STRONG], ['أبحث', STRONG], ['أريد', STRONG], ['مطلوب', STRONG],
    // medium
    ['بودجه', MED], ['budget', MED], ['معرفی کنید', MED], ['سراغ دارید', MED], ['تا سقف', MED],
    ['پیدا کنید', MED], ['کسی هست', MED], ['requirement', MED], ['client looking', MED],
    // weak / ambiguous
    ['میخوام', WEAK], ['میخواهم', WEAK], ['need', WEAK],
  ],
  owner: [
    // strong — offering a specific property they hold
    ['میفروشم', STRONG], ['بفروشم', STRONG], ['میخوام بفروشم', STRONG], ['برای فروش', STRONG],
    ['فروشی', STRONG], ['اجاره میدم', STRONG], ['اجاره میدهم', STRONG], ['رهن میدم', STRONG],
    ['واحد دارم', STRONG], ['ملک دارم', STRONG], ['مالکم', STRONG], ['مالکشم', STRONG],
    ['صاحب ملک', STRONG], ['صاحبشم', STRONG], ['کلید در دست', STRONG], ['واگذاری', STRONG],
    ['for sale', STRONG], ['for rent', STRONG], ['ready to move', STRONG], ['available for', STRONG],
    ['للبيع', STRONG], ['للإيجار', STRONG], ['للايجار', STRONG], ['مالكه', STRONG], ['صاحب العقار', STRONG],
    // medium
    ['owner', MED], ['landlord', MED], ['listing', MED], ['موجر', MED], ['برای اجاره', MED],
    ['available', MED], ['وکالت فروش', MED],
    // weak
    ['مالک', WEAK], ['صاحب', WEAK],
  ],
  colleague: [
    // strong — explicit agent-to-agent market signals
    ['a2a', STRONG], ['کمیسیون', STRONG], ['کمسیون', STRONG], ['commission', STRONG],
    ['50/50', STRONG], ['50-50', STRONG], ['نصف نصف', STRONG], ['همکار', STRONG], ['همکاری', STRONG],
    ['شریک', STRONG], ['agent to agent', STRONG], ['برای همکاران', STRONG], ['هاف کمیشن', STRONG],
    ['half commission', STRONG], ['cross deal', STRONG], ['کولیگ', STRONG],
    // medium
    ['agent', MED], ['ایجنت', MED], ['مشاور املاک', MED], ['بروکر', MED], ['broker', MED],
    ['real estate agent', MED], ['brn', MED], ['rera', MED],
  ],
};

const asciiOnly = (s) => /^[\x00-\x7f]+$/.test(s);

// Precompile every term into a matcher { category, weight, term, test(text) }.
const MATCHERS = [];
for (const [category, terms] of Object.entries(RAW_SIGNALS)) {
  for (const [rawTerm, weight] of terms) {
    const term = normalize(rawTerm);
    if (!term) continue;
    let test;
    if (asciiOnly(term)) {
      const re = new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
      test = (t) => re.test(t);
    } else {
      test = (t) => t.includes(term);
    }
    MATCHERS.push({ category, weight, term: rawTerm, test });
  }
}

// ---- deterministic value extraction ---------------------------------------

const REGIONS = [
  ['dubai marina', 'Dubai Marina'], ['marina', 'Marina'], ['jbr', 'JBR'], ['jvc', 'JVC'],
  ['jumeirah village', 'JVC'], ['downtown', 'Downtown'], ['business bay', 'Business Bay'],
  ['dubai hills', 'Dubai Hills'], ['palm jumeirah', 'Palm Jumeirah'], ['palm', 'Palm Jumeirah'],
  ['arjan', 'Arjan'], ['damac hills', 'Damac Hills'], ['meydan', 'Meydan'], ['creek', 'Dubai Creek'],
  ['silicon oasis', 'Silicon Oasis'], ['sports city', 'Sports City'], ['al furjan', 'Al Furjan'],
  ['jlt', 'JLT'], ['jumeirah lake towers', 'JLT'], ['deira', 'Deira'], ['bur dubai', 'Bur Dubai'],
  ['mbr', 'MBR City'], ['emaar', 'Emaar'], ['مارینا', 'Marina'], ['داون تاون', 'Downtown'],
  ['بیزینس بی', 'Business Bay'], ['پالم', 'Palm Jumeirah'], ['دبی هیلز', 'Dubai Hills'],
];

function extractRegion(t) {
  for (const [needle, label] of REGIONS) {
    if (t.includes(needle)) return label;
  }
  return null;
}

function extractBedrooms(t) {
  if (/\b(studio|استودیو)\b/.test(t) || t.includes('استودیو')) return 0;
  const m = t.match(/(\d+)\s*(?:bhk|br|beds?|bedrooms?|خوابه?|خواب)/);
  return m ? Number(m[1]) : null;
}

function extractSqft(t) {
  let m = t.match(/(\d[\d,]*)\s*(?:sq\s?\.?\s?ft|sqft|square feet|فوت مربع|فوت|متر مربع)/);
  if (!m) m = t.match(/(?:متراژ|مساحت)\s*[:،]?\s*(\d[\d,]*)/);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

// Best-effort AED price. Understands million/میلیون (M), thousand/k/هزار, and a
// bare number sitting next to aed/درهم.
function extractPrice(t) {
  let m = t.match(/(\d[\d,.]*)\s*(?:m\b|million|میلیون|mil\b)/);
  if (m) return Math.round(parseFloat(m[1].replace(/,/g, '')) * 1e6);
  m = t.match(/(\d[\d,.]*)\s*(?:k\b|هزار|thousand)/);
  if (m) return Math.round(parseFloat(m[1].replace(/,/g, '')) * 1e3);
  m = t.match(/(?:aed|درهم|dirham|price|قیمت)\s*[:،]?\s*(\d[\d,]{2,})/) ||
    t.match(/(\d[\d,]{4,})\s*(?:aed|درهم|dirham)/);
  if (m) return Number(m[1].replace(/,/g, ''));
  return null;
}

// NB: `t` is already normalized (Arabic ي/ك → Persian ی/ک), so patterns use
// the Persian letter forms.
function extractRequestType(t) {
  if (/(اجاره|رهن|rent|إیجار|للایجار|للإیجار)/.test(t)) return 'rent';
  if (/(mortgage|وام|تسهیلات|قسط)/.test(t)) return 'mortgage';
  if (/(فروش|میفروشم|بفروشم|for sale|sell|بیع|للبیع)/.test(t)) return 'sell';
  if (/(خرید|بخرم|buy|شراء|خریدارم)/.test(t)) return 'buy';
  return null;
}

function extractPropertyType(t) {
  if (/(کامرشال|تجاری|commercial|office|دفتر|مغازه|shop|retail|warehouse|انبار)/.test(t)) return 'commercial';
  if (/(آپارتمان|apartment|villa|ویلا|studio|استودیو|townhouse|residential|مسکونی)/.test(t)) return 'residential';
  return null;
}

/**
 * Reads ONE message and returns its weighted signals + extracted values.
 * @param {string} rawText
 * @param {{ chatType?: 'private'|'group'|'channel' }} ctx
 */
function scoreMessage(rawText, ctx = {}) {
  const t = normalize(rawText);
  const scores = { client: 0, owner: 0, colleague: 0 };
  const matched = { client: [], owner: [], colleague: [] };
  if (t.length >= 2) {
    for (const m of MATCHERS) {
      if (m.test(t)) {
        scores[m.category] += m.weight;
        matched[m.category].push(m.term);
      }
    }
  }
  const extracted = {
    region: extractRegion(t),
    bedrooms: extractBedrooms(t),
    area_sqft: extractSqft(t),
    price: extractPrice(t),
    request_type: extractRequestType(t),
    property_type: extractPropertyType(t),
  };
  const keywordHit = scores.client + scores.owner + scores.colleague > 0;
  const valueHit = Boolean(
    extracted.region || extracted.bedrooms != null || extracted.area_sqft || extracted.price || extracted.request_type
  );
  const relevant = keywordHit || valueHit;

  // Group context nudges toward the A2A/colleague market, but only on messages
  // that are actually about real estate (so plain group chatter is ignored).
  if (relevant && (ctx.chatType === 'group' || ctx.chatType === 'channel')) {
    scores.colleague += GROUP_COLLEAGUE_BIAS;
  }
  return { scores, matched, extracted, relevant };
}

// ---- profile aggregation + stable decision ---------------------------------

function emptySignals() {
  return { client: 0, owner: 0, colleague: 0, messages: 0 };
}

// Decide the label + confidence from accumulated signals, honoring hysteresis
// against a previously established label.
function decide(signals, prevRole) {
  const total = signals.client + signals.owner + signals.colleague;
  if (total <= 0) return { role: 'unknown', confidence: 0, needsReview: false };

  const ranked = [
    ['client', signals.client],
    ['owner', signals.owner],
    ['colleague', signals.colleague],
  ].sort((a, b) => b[1] - a[1]);
  let [topRole, topScore] = ranked[0];
  const secondScore = ranked[1][1];

  // Hysteresis: keep an established label unless the new leader clearly beats it.
  if (prevRole && prevRole !== 'unknown' && topRole !== prevRole) {
    const prevScore = signals[prevRole] || 0;
    if (topScore - prevScore < FLIP_MARGIN) {
      topRole = prevRole;
      topScore = prevScore;
    }
  }

  const share = topScore / total;
  const evidence = Math.min(1, total / 6); // ~6 weighted points ⇒ "well-evidenced"
  let confidence = Math.round(share * (0.55 + 0.45 * evidence) * 100);
  if (topScore - secondScore <= 1 && total < 6) confidence = Math.min(confidence, 55);
  confidence = Math.max(0, Math.min(100, confidence));

  return { role: topRole, confidence, needsReview: confidence < LOCK_CONF };
}

// Keep the most informative extracted values across messages (newest non-null
// wins; never clobber a known value with null).
function mergeExtracted(prev = {}, next = {}) {
  const out = { ...prev };
  for (const k of ['region', 'bedrooms', 'area_sqft', 'price', 'request_type', 'property_type']) {
    if (next[k] != null && next[k] !== '') out[k] = next[k];
    else if (out[k] === undefined) out[k] = prev[k] ?? null;
  }
  return out;
}

/**
 * Folds one scored message into a contact's rolling profile.
 * @param {object} prev  the existing chat row (or {}), read from the DB
 * @param {object} msg   the result of scoreMessage()
 * @param {{ manual?: boolean, aiRole?: string, aiWeight?: number }} opts
 *   manual  — the user set the role by hand: never auto-change it.
 *   aiRole  — optional Gemini-decided role to fold in as one extra signal.
 * @returns {{ signals, role, roleSource, confidence, needsReview, extracted, changed }}
 */
function updateProfile(prev = {}, msg, opts = {}) {
  const prevSignals = normalizeSignals(prev.signals);
  const prevExtracted = prev.extracted || {};
  const manual = opts.manual || prev.role_source === 'manual';

  if (!msg.relevant && !opts.aiRole) {
    // Nothing to learn from this message; leave the profile as-is.
    return {
      signals: prevSignals,
      role: prev.role || 'unknown',
      roleSource: prev.role_source || 'ai',
      confidence: prev.confidence || 0,
      needsReview: Boolean(prev.needs_review),
      extracted: prevExtracted,
      changed: false,
    };
  }

  const signals = {
    client: prevSignals.client + msg.scores.client,
    owner: prevSignals.owner + msg.scores.owner,
    colleague: prevSignals.colleague + msg.scores.colleague,
    messages: prevSignals.messages + 1,
  };
  // Optional AI vote: one extra strong signal toward the AI-decided role.
  if (opts.aiRole && signals[opts.aiRole] != null) {
    signals[opts.aiRole] += opts.aiWeight || STRONG;
  }

  const extracted = mergeExtracted(prevExtracted, msg.extracted || {});

  if (manual) {
    // Keep learning signals/values, but the label stays exactly as the user set it.
    return {
      signals,
      role: prev.role || 'unknown',
      roleSource: 'manual',
      confidence: 100,
      needsReview: false,
      extracted,
      changed: true,
    };
  }

  const decided = decide(signals, prev.role);
  return {
    signals,
    role: decided.role,
    roleSource: 'ai',
    confidence: decided.confidence,
    needsReview: decided.needsReview,
    extracted,
    changed: true,
  };
}

function normalizeSignals(s) {
  if (!s || typeof s !== 'object') return emptySignals();
  return {
    client: Number(s.client) || 0,
    owner: Number(s.owner) || 0,
    colleague: Number(s.colleague) || 0,
    messages: Number(s.messages) || 0,
  };
}

module.exports = {
  scoreMessage,
  updateProfile,
  decide,
  normalize,
  LOCK_CONF,
  FLIP_MARGIN,
};
