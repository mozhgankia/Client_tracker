// Persists the GramJS session string in Supabase instead of on local disk —
// required so the connection survives a restart on ephemeral-disk free tiers
// (Render, Hugging Face Spaces).
'use strict';

const supabase = require('../db/supabaseClient');

async function loadSessionString(userId) {
  const { data, error } = await supabase
    .from('telegram_sessions')
    .select('session_string')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`خواندن نشست تلگرام از Supabase شکست خورد: ${error.message}`);
  return data ? data.session_string : '';
}

async function saveSessionString(userId, sessionString) {
  const { error } = await supabase
    .from('telegram_sessions')
    .upsert({ user_id: userId, session_string: sessionString, updated_at: new Date().toISOString() });
  if (error) throw new Error(`ذخیره‌ی نشست تلگرام در Supabase شکست خورد: ${error.message}`);
}

async function deleteSessionString(userId) {
  const { error } = await supabase.from('telegram_sessions').delete().eq('user_id', userId);
  if (error) throw new Error(`حذف نشست تلگرام از Supabase شکست خورد: ${error.message}`);
}

module.exports = { loadSessionString, saveSessionString, deleteSessionString };
