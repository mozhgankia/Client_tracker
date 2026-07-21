// Per-tenant classification settings: the editable keyword lists that drive
// the intelligent classifier. If a tenant hasn't customized them, we fall back
// to these sensible Dubai-market defaults (Persian + English + Arabic).
'use strict';

const supabase = require('./supabaseClient');

// Signals the sender is an OWNER (listing/selling/renting-out a property).
const DEFAULT_OWNER_KEYWORDS = [
  'مالک', 'مالکم', 'صاحب', 'ملکم', 'واحدم', 'فروشی', 'برای فروش', 'واگذاری',
  'می‌فروشم', 'میفروشم', 'اجاره می‌دهم', 'اجاره میدم', 'رهن می‌دهم',
  'owner', 'landlord', 'for sale', 'for rent', 'listing', 'available',
  'مالكه', 'صاحب العقار', 'للبيع', 'للإيجار', 'للايجار',
];

// Signals the sender is a CLIENT (looking to buy/rent).
const DEFAULT_CLIENT_KEYWORDS = [
  'دنبال', 'می‌خوام', 'میخوام', 'می‌خواهم', 'نیاز دارم', 'متقاضی', 'خریدارم',
  'مستاجرم', 'بودجه', 'اجاره می‌خوام', 'اجاره میخوام', 'دنبالِ خرید',
  'looking for', 'need', 'want to buy', 'want to rent', 'budget', 'tenant', 'buyer',
  'أبحث', 'أريد', 'مطلوب', 'مستأجر', 'مشتري',
];

// A PostgREST "table not present in the schema cache" error — happens when the
// user_settings migration hasn't been run on this Supabase project yet. We
// treat it as "no custom settings" and fall back to defaults, so the settings
// and classification pages keep working instead of crashing.
function isMissingTable(error) {
  return (
    error &&
    (error.code === 'PGRST205' ||
      error.code === '42P01' ||
      /schema cache|could not find the table/i.test(error.message || ''))
  );
}

/** Returns the tenant's settings, filling any empty list with the defaults so
 *  callers always get usable keyword lists. */
async function getSettings(userId) {
  const { data, error } = await supabase
    .from('user_settings')
    .select('owner_keywords, client_keywords')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) {
      return { owner_keywords: DEFAULT_OWNER_KEYWORDS, client_keywords: DEFAULT_CLIENT_KEYWORDS, customized: false };
    }
    throw new Error(error.message);
  }

  const owner = data?.owner_keywords?.length ? data.owner_keywords : DEFAULT_OWNER_KEYWORDS;
  const client = data?.client_keywords?.length ? data.client_keywords : DEFAULT_CLIENT_KEYWORDS;
  return {
    owner_keywords: owner,
    client_keywords: client,
    // Whether the tenant has explicitly saved a customized list (vs. defaults).
    customized: Boolean(data),
  };
}

/** Upserts the tenant's keyword lists. Missing fields keep their current
 *  (or default) value. */
async function updateSettings(userId, patch = {}) {
  const current = await getSettings(userId);
  const row = {
    user_id: userId,
    owner_keywords: Array.isArray(patch.owner_keywords) ? patch.owner_keywords : current.owner_keywords,
    client_keywords: Array.isArray(patch.client_keywords) ? patch.client_keywords : current.client_keywords,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('user_settings').upsert(row, { onConflict: 'user_id' });
  if (error) {
    if (isMissingTable(error)) {
      const e = new Error('جدول تنظیمات هنوز در دیتابیس ساخته نشده است. لطفاً schema.sql را در Supabase اجرا کنید.');
      e.code = 'settings_table_missing';
      throw e;
    }
    throw new Error(error.message);
  }
  return { owner_keywords: row.owner_keywords, client_keywords: row.client_keywords, customized: true };
}

module.exports = { getSettings, updateSettings, DEFAULT_OWNER_KEYWORDS, DEFAULT_CLIENT_KEYWORDS };
