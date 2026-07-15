'use strict';

const supabase = require('./supabaseClient');

/**
 * Upserts a lead, deduped by (user_id, phone/telegram_id, source_chat_id) —
 * mirrors the compound-key dedup pattern already used for WhatsApp new-leads
 * (phone + property), so the same person mentioning a second property still
 * creates a second row instead of overwriting the first.
 */
async function saveLead(userId, extracted, meta) {
  const row = {
    user_id: userId,
    source: meta.source,
    source_chat_id: meta.chatId,
    sender_name: extracted.contact_name || meta.senderName || null,
    phone: meta.phone || null,
    telegram_id: meta.telegramId || null,
    role: extracted.role,
    request_type: extracted.request_type,
    bedrooms: extracted.bedrooms ?? null,
    area_sqft: extracted.area_sqft ?? null,
    region: extracted.region ?? null,
    listed_price: extracted.listed_price ?? null,
    parking: extracted.parking ?? null,
    raw_message: meta.rawMessage,
  };

  const { data, error } = await supabase.from('leads').insert(row).select().single();
  if (error) throw new Error(`ذخیره‌ی لید در Supabase شکست خورد: ${error.message}`);
  return data;
}

module.exports = { saveLead };
