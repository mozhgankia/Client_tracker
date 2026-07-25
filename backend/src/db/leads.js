'use strict';

const supabase = require('./supabaseClient');
const { createCustomer } = require('./customers');
const { createProperty } = require('./properties');

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
    context: meta.context || 'direct',
  };

  const { data, error } = await supabase.from('leads').insert(row).select().single();
  if (error) throw new Error(`ذخیره‌ی لید در Supabase شکست خورد: ${error.message}`);
  return data;
}

async function listLeads(userId, filters = {}) {
  let query = supabase.from('leads').select('*').eq('user_id', userId).eq('context', 'direct');
  query = query.eq('status', filters.status || 'new'); // "پیگیری امروز" wants new leads by default
  if (filters.source) query = query.eq('source', filters.source);

  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}

async function getLead(userId, id) {
  const { data, error } = await supabase.from('leads').select('*').eq('id', id).eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** True if this exact message from this sender was already saved — used to
 *  dedup history sync so re-running it never creates duplicate leads. */
async function leadExists(userId, { source, telegramId, phone, rawMessage }) {
  if (!rawMessage) return false;
  let query = supabase
    .from('leads')
    .select('id')
    .eq('user_id', userId)
    .eq('source', source)
    .eq('raw_message', rawMessage)
    .limit(1);
  if (telegramId) query = query.eq('telegram_id', telegramId);
  else if (phone) query = query.eq('phone', phone);
  const { data, error } = await query;
  if (error) return false; // on error, don't block saving
  return Array.isArray(data) && data.length > 0;
}

/** All non-dismissed personal (direct-chat) leads for a tenant, grouped by role
 *  for the classification board (owners / clients / unknown). Group/A2A leads
 *  are excluded — they belong to the colleague-market board, not here. */
async function listActiveLeads(userId) {
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .eq('user_id', userId)
    .eq('context', 'direct')
    .neq('status', 'dismissed')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

/** Group/A2A leads of a given role: role='owner' → colleague property listings,
 *  role='client' → colleague clients looking for a property. */
async function listGroupLeads(userId, role) {
  let query = supabase
    .from('leads')
    .select('*')
    .eq('user_id', userId)
    .eq('context', 'group')
    .neq('status', 'dismissed');
  if (role) query = query.eq('role', role);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

/** Sets a lead's role (used when the user accepts an AI suggestion or manually
 *  reclassifies a contact). */
async function setLeadRole(userId, id, role) {
  if (!['owner', 'client', 'unknown'].includes(role)) throw new Error('نقش نامعتبر است.');
  const { data, error } = await supabase
    .from('leads')
    .update({ role, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** Dismiss (or otherwise re-flag) a lead without turning it into a record. */
async function updateLeadStatus(userId, id, status) {
  const { data, error } = await supabase
    .from('leads')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function deleteLead(userId, id) {
  const { error } = await supabase.from('leads').delete().eq('id', id).eq('user_id', userId);
  if (error) throw new Error(error.message);
}

/**
 * Turns a lead into a real customer row. `overrides` lets the dashboard
 * adjust/complete fields (type, subtype, potential, status, notes) before
 * finalizing, since a lead's AI-extracted fields don't map 1:1 onto the
 * customers table. Marks the lead 'added' and links it to the new row so
 * it can never be added twice.
 */
async function convertLeadToCustomer(userId, id, overrides = {}) {
  const lead = await getLead(userId, id);
  if (!lead) throw new Error('لید پیدا نشد.');
  if (lead.status === 'added') throw new Error('این لید قبلاً اضافه شده است.');

  const customer = await createCustomer(userId, {
    name: lead.sender_name || 'بدون‌نام',
    phone: lead.phone || lead.telegram_id || '',
    ...overrides,
  });

  const { error } = await supabase
    .from('leads')
    .update({ status: 'added', converted_customer_id: customer.id, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId);
  if (error) throw new Error(error.message);

  return customer;
}

/**
 * Turns a lead into a real property row. The dashboard must supply at least
 * `category` (and `sub_category` for secondary listings) in `overrides`,
 * since a lead alone doesn't know which bucket it belongs to.
 */
async function convertLeadToProperty(userId, id, overrides = {}) {
  const lead = await getLead(userId, id);
  if (!lead) throw new Error('لید پیدا نشد.');
  if (lead.status === 'added') throw new Error('این لید قبلاً اضافه شده است.');
  if (!overrides.category) throw new Error('دسته‌ی ملک (category) الزامی است.');

  const property = await createProperty(userId, {
    title: lead.region ? `ملک در ${lead.region}` : 'ملک بدون عنوان',
    location: lead.region || null,
    area_sqft: lead.area_sqft || null,
    price: lead.listed_price || null,
    owner_phone: lead.phone || null,
    ...overrides,
  });

  const { error } = await supabase
    .from('leads')
    .update({ status: 'added', converted_property_id: property.id, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId);
  if (error) throw new Error(error.message);

  return property;
}

module.exports = {
  saveLead,
  leadExists,
  listLeads,
  listActiveLeads,
  listGroupLeads,
  setLeadRole,
  getLead,
  updateLeadStatus,
  deleteLead,
  convertLeadToCustomer,
  convertLeadToProperty,
};
