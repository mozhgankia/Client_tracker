// Data access for the `properties` table — covers both primary (developer)
// and secondary (owner-resale) listings via the `category`/`sub_category`
// fields, matching the taxonomy from the original single-tenant app.
'use strict';

const supabase = require('./supabaseClient');

const ALLOWED_FIELDS = [
  'category',
  'sub_category',
  'delivery_status',
  'title',
  'location',
  'area_sqft',
  'price',
  'description',
  'owner_phone',
  'owner_contact_platform',
  'drive_folder_link',
  'developer_name',
  'priority',
];

function pickAllowed(body) {
  const result = {};
  for (const key of ALLOWED_FIELDS) {
    if (body[key] !== undefined) result[key] = body[key];
  }
  return result;
}

async function listProperties(userId, filters = {}) {
  let query = supabase.from('properties').select('*').eq('user_id', userId);
  if (filters.category) query = query.eq('category', filters.category);
  if (filters.sub_category) query = query.eq('sub_category', filters.sub_category);
  if (filters.delivery_status) query = query.eq('delivery_status', filters.delivery_status);

  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}

async function getProperty(userId, id) {
  const { data, error } = await supabase
    .from('properties')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function createProperty(userId, body) {
  if (!body.title || !body.category) throw new Error('عنوان و دسته‌ی ملک (category) الزامی است.');
  const row = { ...pickAllowed(body), user_id: userId };
  const { data, error } = await supabase.from('properties').insert(row).select().single();
  if (error) throw new Error(error.message);
  return data;
}

async function updateProperty(userId, id, body) {
  const updates = { ...pickAllowed(body), updated_at: new Date().toISOString() };
  const { data, error } = await supabase
    .from('properties')
    .update(updates)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function deleteProperty(userId, id) {
  const { error } = await supabase.from('properties').delete().eq('id', id).eq('user_id', userId);
  if (error) throw new Error(error.message);
}

module.exports = { listProperties, getProperty, createProperty, updateProperty, deleteProperty };
