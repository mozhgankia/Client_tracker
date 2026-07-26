// Data access for the inbox `chats` table — one row per conversation, upserted
// by (user_id, source, chat_id) so re-syncing updates the last message/label
// instead of duplicating.
'use strict';

const supabase = require('./supabaseClient');

async function getChat(userId, source, chatId) {
  const { data, error } = await supabase
    .from('chats')
    .select('*')
    .eq('user_id', userId)
    .eq('source', source)
    .eq('chat_id', String(chatId))
    .maybeSingle();
  if (error) return null; // resilient: never block a sync on a read
  return data || null;
}

async function upsertChat(userId, c) {
  const row = {
    user_id: userId,
    source: c.source,
    chat_id: String(c.chatId),
    context: c.context || 'direct',
    name: c.name || null,
    phone: c.phone || null,
    telegram_id: c.telegramId || null,
    last_message: c.lastMessage || null,
    last_message_at: c.lastMessageAt || null,
    role: c.role || 'unknown',
    role_source: c.roleSource || 'ai',
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('chats').upsert(row, { onConflict: 'user_id,source,chat_id' });
  if (error) throw new Error(error.message);
}

async function listChats(userId, { source } = {}) {
  let query = supabase.from('chats').select('*').eq('user_id', userId);
  if (source) query = query.eq('source', source);
  const { data, error } = await query.order('last_message_at', { ascending: false, nullsFirst: false });
  if (error) throw new Error(error.message);
  return data || [];
}

async function setChatRole(userId, id, role) {
  if (!['owner', 'client', 'unknown'].includes(role)) throw new Error('نقش نامعتبر است.');
  const { data, error } = await supabase
    .from('chats')
    .update({ role, role_source: 'manual', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

module.exports = { getChat, upsertChat, listChats, setChatRole };
