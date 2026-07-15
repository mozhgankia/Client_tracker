// Stateless replacement for Baileys' `useMultiFileAuthState`: keeps the
// credential blob and signal-protocol keys in a single Supabase row instead
// of a directory of files, so a session survives a restart on free-tier
// hosts with ephemeral disks (Render, Hugging Face Spaces).
'use strict';

const { proto, BufferJSON, initAuthCreds } = require('@whiskeysockets/baileys');
const supabase = require('../db/supabaseClient');

function toStorable(value) {
  return JSON.parse(JSON.stringify(value, BufferJSON.replacer));
}
function fromStorable(value) {
  return JSON.parse(JSON.stringify(value), BufferJSON.reviver);
}

/**
 * @param {string} userId - the tenant this WhatsApp connection belongs to
 */
async function useSupabaseAuthState(userId) {
  const { data: row, error } = await supabase
    .from('whatsapp_sessions')
    .select('auth_creds, auth_keys')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`خواندن نشست واتساپ از Supabase شکست خورد: ${error.message}`);

  const creds = row && row.auth_creds ? fromStorable(row.auth_creds) : initAuthCreds();
  const keyData = row && row.auth_keys ? { ...row.auth_keys } : {};

  const persist = async () => {
    const { error: upsertError } = await supabase.from('whatsapp_sessions').upsert({
      user_id: userId,
      auth_creds: toStorable(creds),
      auth_keys: keyData,
      connected: true,
      updated_at: new Date().toISOString(),
    });
    if (upsertError) throw new Error(`ذخیره‌ی نشست واتساپ در Supabase شکست خورد: ${upsertError.message}`);
  };

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const result = {};
          for (const id of ids) {
            const stored = keyData[`${type}-${id}`];
            if (stored == null) continue;
            let value = fromStorable(stored);
            if (type === 'app-state-sync-key') {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            result[id] = value;
          }
          return result;
        },
        set: async (data) => {
          for (const type of Object.keys(data)) {
            for (const id of Object.keys(data[type])) {
              const value = data[type][id];
              const key = `${type}-${id}`;
              if (value) keyData[key] = toStorable(value);
              else delete keyData[key];
            }
          }
          await persist();
        },
      },
    },
    saveCreds: persist,
  };
}

module.exports = { useSupabaseAuthState };
