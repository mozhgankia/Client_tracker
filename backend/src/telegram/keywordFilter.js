// Cheap first-pass filter so we only pay for an AI call on messages that are
// plausibly about real estate. Runs before any Gemini/Claude request.
'use strict';

const KEYWORDS = [
  // request type
  'اجاره', 'رهن', 'خرید', 'فروش', 'پیش‌فروش', 'پیش فروش',
  // parties
  'مشتری', 'خریدار', 'مالک', 'موجر', 'مستاجر',
  // property nouns
  'آپارتمان', 'ملک', 'واحد', 'برج', 'ویلا', 'استودیو',
  // spec terms
  'متراژ', 'متر', 'خواب', 'پارکینگ', 'قیمت', 'فوت مربع', 'sq ft',
  // English/Arabic equivalents (mixed-language chats are common in Dubai groups)
  'rent', 'sale', 'sell', 'buy', 'apartment', 'villa', 'tower', 'studio',
  'sqft', 'bedroom', 'parking', 'price', 'aed',
  'إيجار', 'بيع', 'شراء', 'شقة', 'فيلا', 'عقار',
];

const KEYWORD_REGEX = new RegExp(KEYWORDS.map(escapeRegex).join('|'), 'i');

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** @returns {boolean} true if the message text is worth sending to the AI. */
function isLikelyRealEstateMessage(text) {
  if (!text || text.trim().length < 6) return false;
  return KEYWORD_REGEX.test(text);
}

module.exports = { isLikelyRealEstateMessage, KEYWORDS };
