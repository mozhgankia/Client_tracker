// Signup / login / password-reset. Every error response carries a stable
// `code` (in addition to a human-readable `error`) so the frontend can show
// the message in the user's chosen language (fa/en/ar) rather than echoing a
// server-side string.
'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const supabase = require('../db/supabaseClient');
const { signToken } = require('./jwt');
const {
  createResetToken,
  sendResetEmail,
  consumeResetToken,
  setUserPassword,
} = require('./passwordReset');

const router = express.Router();

router.post('/signup', async (req, res) => {
  const { email, password, fullName } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ code: 'missing_fields', error: 'ایمیل و رمز عبور الزامی است.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const { data, error } = await supabase
    .from('users')
    .insert({ email, password_hash: passwordHash, full_name: fullName || null })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ code: 'email_taken', error: 'این ایمیل قبلاً ثبت شده است.' });
    }
    return res.status(500).json({ code: 'signup_failed', error: error.message });
  }

  res.json({ token: signToken(data.id) });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ code: 'missing_fields', error: 'ایمیل و رمز عبور الزامی است.' });
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('id, password_hash')
    .eq('email', email)
    .maybeSingle();

  if (error) return res.status(500).json({ code: 'server_error', error: error.message });
  if (!user) return res.status(401).json({ code: 'invalid_credentials', error: 'ایمیل یا رمز عبور اشتباه است.' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ code: 'invalid_credentials', error: 'ایمیل یا رمز عبور اشتباه است.' });

  res.json({ token: signToken(user.id) });
});

// Always responds 200 with the same body, whether or not the email exists, so
// it can't be used to discover which addresses are registered.
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ code: 'missing_fields', error: 'ایمیل الزامی است.' });
  try {
    const token = await createResetToken(email);
    if (token) await sendResetEmail(email, token);
  } catch (err) {
    // Log but don't leak details to the caller.
    console.error('[forgot-password]', err.message);
  }
  res.json({ ok: true });
});

router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) {
    return res.status(400).json({ code: 'missing_fields', error: 'توکن و رمز عبور جدید الزامی است.' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ code: 'weak_password', error: 'رمز عبور باید حداقل ۶ کاراکتر باشد.' });
  }
  const userId = await consumeResetToken(token);
  if (!userId) {
    return res.status(400).json({ code: 'invalid_reset_token', error: 'لینک بازیابی نامعتبر یا منقضی شده است.' });
  }
  await setUserPassword(userId, password);
  res.json({ ok: true });
});

module.exports = router;
