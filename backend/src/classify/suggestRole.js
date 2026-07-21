// AI suggestion step for the "unknown" bucket: when neither the keyword
// classifier nor the first-pass extraction could tell whether a contact is an
// owner or a client, this asks Gemini to make a focused owner-vs-client call
// and explain why — a suggestion the user then accepts or rejects.
'use strict';

const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');

const GEMINI_MODEL = 'gemini-1.5-flash';

const SUGGEST_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    role: {
      type: SchemaType.STRING,
      format: 'enum',
      enum: ['owner', 'client', 'unknown'],
      description: 'مالک ملک است، مشتری/متقاضی است، یا واقعاً از متن مشخص نیست',
    },
    confidence: {
      type: SchemaType.NUMBER,
      description: 'میزان اطمینان بین ۰ تا ۱',
    },
    reason: {
      type: SchemaType.STRING,
      description: 'یک جمله‌ی کوتاه به فارسی که دلیل این حدس را توضیح می‌دهد',
    },
  },
  required: ['role', 'confidence', 'reason'],
};

function getModel() {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY تنظیم نشده است.');
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: { responseMimeType: 'application/json', responseSchema: SUGGEST_SCHEMA },
  });
}

/**
 * @param {string} messageText the contact's message(s)
 * @param {{ senderName?: string }} [context]
 * @returns {Promise<{ role: string, confidence: number, reason: string }>}
 */
async function suggestRole(messageText, context = {}) {
  const model = getModel();
  const prompt =
    `این پیام از یک مخاطب در بازار املاک دبی است و هنوز مشخص نشده مالک است یا مشتری.\n` +
    `نام فرستنده (در صورت وجود): ${context.senderName || 'نامشخص'}\n` +
    `متن پیام:\n"""${messageText}"""\n\n` +
    `تصمیم بگیر که فرستنده «مالک» (کسی که ملکی برای فروش/اجاره دارد) است یا «مشتری» ` +
    `(کسی که دنبال خرید/اجاره است). اگر واقعاً قابل تشخیص نیست، role را unknown بگذار. ` +
    `دلیل را در یک جمله‌ی کوتاه بنویس.`;

  const result = await model.generateContent(prompt);
  return JSON.parse(result.response.text());
}

module.exports = { suggestRole };
