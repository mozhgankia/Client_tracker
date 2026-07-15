// Cheap/light AI step: classify a single message as owner vs client/buyer and
// pull out structured lead fields. Uses Gemini 1.5 Flash (free tier via
// Google AI Studio) instead of Claude here specifically to keep the
// per-message cost near zero — this runs on every message that survives the
// keyword filter, which is a much higher volume than the "heavy" analysis
// path in claudeAnalyze.js.
'use strict';

const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');

const GEMINI_MODEL = 'gemini-1.5-flash';

const LEAD_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    is_relevant: {
      type: SchemaType.BOOLEAN,
      description: 'آیا این پیام واقعاً درباره‌ی خرید/فروش/اجاره/رهن ملک است؟',
    },
    role: {
      type: SchemaType.STRING,
      format: 'enum',
      enum: ['owner', 'client', 'unknown'],
      description: 'فرستنده مالک ملک است، مشتری/متقاضی است، یا مشخص نیست',
    },
    request_type: {
      type: SchemaType.STRING,
      format: 'enum',
      enum: ['buy', 'sell', 'rent', 'mortgage', 'unknown'],
    },
    bedrooms: { type: SchemaType.INTEGER, nullable: true },
    area_sqft: { type: SchemaType.NUMBER, nullable: true },
    region: { type: SchemaType.STRING, nullable: true, description: 'منطقه/محله ذکرشده در پیام' },
    listed_price: { type: SchemaType.NUMBER, nullable: true },
    parking: { type: SchemaType.BOOLEAN, nullable: true },
    contact_name: { type: SchemaType.STRING, nullable: true },
  },
  required: ['is_relevant', 'role', 'request_type'],
};

function getModel() {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY تنظیم نشده است.');
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: LEAD_SCHEMA,
    },
  });
}

/**
 * Extracts a structured lead object from a single chat message.
 * @param {string} messageText
 * @param {{ senderName?: string }} context
 * @returns {Promise<object>} parsed JSON matching LEAD_SCHEMA
 */
async function extractLeadFromMessage(messageText, context = {}) {
  const model = getModel();
  const prompt =
    `پیام زیر از یک چت/گروه واتساپ یا تلگرام مرتبط با املاک دبی است.\n` +
    `نام فرستنده (در صورت وجود): ${context.senderName || 'نامشخص'}\n` +
    `متن پیام:\n"""${messageText}"""\n\n` +
    `اگر پیام واقعاً درباره‌ی خرید/فروش/اجاره/رهن ملک نیست، is_relevant را false بگذار و بقیه‌ی فیلدها را unknown/null بگذار.`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  return JSON.parse(text);
}

module.exports = { extractLeadFromMessage, LEAD_SCHEMA };
