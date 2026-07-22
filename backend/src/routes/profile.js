// The signed-in user's own profile: read it, and update the profile picture
// (and full name). Mounted behind requireAuth, so it always acts on req.userId.
'use strict';

const express = require('express');
const supabase = require('../db/supabaseClient');

const router = express.Router();

// ~700KB cap on the stored data URL — the frontend downscales to ~160px first,
// so a normal avatar is only a few KB; this just guards against abuse.
const MAX_AVATAR_LEN = 700000;

function isMissingColumn(error) {
  return (
    error &&
    (error.code === '42703' ||
      error.code === 'PGRST204' ||
      /column .*avatar_url|schema cache/i.test(error.message || ''))
  );
}

router.get('/', async (req, res) => {
  // select('*') so a database that hasn't run the avatar_url migration yet
  // still returns the rest of the profile instead of erroring.
  const { data, error } = await supabase.from('users').select('*').eq('id', req.userId).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ email: data?.email, full_name: data?.full_name, avatar_url: data?.avatar_url ?? null });
});

router.patch('/', async (req, res) => {
  const body = req.body || {};
  const patch = {};

  if (typeof body.full_name === 'string') patch.full_name = body.full_name;

  if ('avatar_url' in body) {
    const v = body.avatar_url;
    if (v !== null && typeof v !== 'string') {
      return res.status(400).json({ error: 'تصویر نامعتبر است.' });
    }
    if (typeof v === 'string' && v.length > MAX_AVATAR_LEN) {
      return res.status(413).json({ code: 'avatar_too_large', error: 'حجم تصویر زیاد است.' });
    }
    patch.avatar_url = v; // string data URL, or null to remove
  }

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'چیزی برای به‌روزرسانی نیست.' });
  }

  const { data, error } = await supabase
    .from('users')
    .update(patch)
    .eq('id', req.userId)
    .select('email, full_name, avatar_url')
    .maybeSingle();

  if (error) {
    if (isMissingColumn(error)) {
      return res.status(400).json({
        code: 'avatar_column_missing',
        error: 'ستون avatar_url هنوز در دیتابیس ساخته نشده است. لطفاً schema.sql را در Supabase اجرا کنید.',
      });
    }
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

module.exports = router;
