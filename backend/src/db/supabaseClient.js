// Single shared Supabase client. Uses the service-role key because the
// backend (not the browser) is what talks to Postgres directly — the
// frontend only ever calls our Express API, never Supabase directly.
'use strict';

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY باید تنظیم شده باشند.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

module.exports = supabase;
