// Data access for the `customers` table. Every function takes userId first
// and filters/checks ownership on it — the routes never trust an id alone,
// since customer rows are tenant-scoped.
'use strict';

const supabase = require('./supabaseClient');

const ALLOWED_FIELDS = [
  'name',
  'phone',
  'type',
  'subtype',
  'potential',
  'status',
  'notes',
  'first_message_at',
  'last_follow_up_at',
];

function pickAllowed(body) {
  const result = {};
  for (const key of ALLOWED_FIELDS) {
    if (body[key] !== undefined) result[key] = body[key];
  }
  return result;
}

async function listCustomers(userId, filters = {}) {
  let query = supabase.from('customers').select('*').eq('user_id', userId);
  if (filters.type) query = query.eq('type', filters.type);
  if (filters.subtype) query = query.eq('subtype', filters.subtype);
  if (filters.potential) query = query.eq('potential', filters.potential);
  if (filters.status) query = query.eq('status', filters.status);

  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}

async function getCustomer(userId, id) {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function createCustomer(userId, body) {
  if (!body.name || !body.phone) throw new Error('نام و شماره تماس مشتری الزامی است.');
  const row = { ...pickAllowed(body), user_id: userId };
  const { data, error } = await supabase.from('customers').insert(row).select().single();
  if (error) throw new Error(error.message);
  return data;
}

async function updateCustomer(userId, id, body) {
  const updates = { ...pickAllowed(body), updated_at: new Date().toISOString() };
  const { data, error } = await supabase
    .from('customers')
    .update(updates)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function deleteCustomer(userId, id) {
  const { error } = await supabase.from('customers').delete().eq('id', id).eq('user_id', userId);
  if (error) throw new Error(error.message);
}

module.exports = { listCustomers, getCustomer, createCustomer, updateCustomer, deleteCustomer };
