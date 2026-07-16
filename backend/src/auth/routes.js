// Minimal signup/login so the JWT middleware is actually testable end to
// end. Full account management (password reset, email verification, etc.)
// is out of scope here — this is just enough to issue a real token for a
// real user row.
'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const supabase = require('../db/supabaseClient');
const { signToken } = require('./jwt');

const router = express.Router();

router.post('/signup', async (req, res) => {
  const { email, password, fullName } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'ایمیل و رمز عبور الزامی است.' });

  const passwordHash = await bcrypt.hash(password, 10);
  const { data, error } = await supabase
    .from('users')
    .insert({ email, password_hash: passwordHash, full_name: fullName || null })
    .select('id')
    .single();

  if (error) {
    const status = error.code === '23505' ? 409 : 500; // unique_violation on email
    return res.status(status).json({ error: error.message });
  }

  res.json({ token: signToken(data.id) });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'ایمیل و رمز عبور الزامی است.' });

  const { data: user, error } = await supabase
    .from('users')
    .select('id, password_hash')
    .eq('email', email)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!user) return res.status(401).json({ error: 'ایمیل یا رمز عبور اشتباه است.' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'ایمیل یا رمز عبور اشتباه است.' });

  res.json({ token: signToken(user.id) });
});

module.exports = router;
