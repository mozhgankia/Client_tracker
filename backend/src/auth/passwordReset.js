// Password-reset token store + email. Tokens are single-use and expire after
// one hour. We never reveal whether an email exists (createResetToken returns
// null silently for unknown emails) so the endpoint can't be used to probe
// which addresses are registered.
'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const supabase = require('../db/supabaseClient');
const { sendEmail } = require('../email/sendEmail');

const TTL_MS = 60 * 60 * 1000; // 1 hour

/** Creates a reset token for the email if a user exists; returns the token (so
 *  the caller can email it) or null. */
async function createResetToken(email) {
  const { data: user } = await supabase.from('users').select('id').eq('email', email).maybeSingle();
  if (!user) return null;

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + TTL_MS).toISOString();
  const { error } = await supabase.from('password_resets').insert({ token, user_id: user.id, expires_at: expiresAt });
  if (error) throw new Error(error.message);
  return token;
}

/** Sends the reset link (or logs it when no email provider is configured). */
async function sendResetEmail(email, token) {
  const base = (process.env.FRONTEND_URL || '').replace(/\/+$/, '');
  const link = `${base}/reset-password?token=${token}`;
  await sendEmail({
    to: email,
    subject: 'بازیابی رمز عبور — Estatemate',
    text: `برای تنظیم رمز عبور جدید روی این لینک بزنید (تا یک ساعت معتبر است):\n${link}`,
    html:
      `<div style="font-family:sans-serif;line-height:1.8">` +
      `<h2>بازیابی رمز عبور</h2>` +
      `<p>برای تنظیم رمز عبور جدید روی دکمه‌ی زیر بزنید. این لینک تا یک ساعت معتبر است.</p>` +
      `<p><a href="${link}" style="background:#0F7B55;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none">تنظیم رمز جدید</a></p>` +
      `<p style="color:#888;font-size:12px">اگر این درخواست از طرف شما نبوده، این ایمیل را نادیده بگیرید.</p>` +
      `</div>`,
  });
}

/** Validates + consumes a token (single use), returning the user id or null. */
async function consumeResetToken(token) {
  const { data: row } = await supabase
    .from('password_resets')
    .select('user_id, expires_at')
    .eq('token', token)
    .maybeSingle();
  if (!row) return null;

  // Delete first so the token can't be reused even if the update below retries.
  await supabase.from('password_resets').delete().eq('token', token);
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return row.user_id;
}

/** Sets a new password for the given user id. */
async function setUserPassword(userId, newPassword) {
  const passwordHash = await bcrypt.hash(newPassword, 10);
  const { error } = await supabase.from('users').update({ password_hash: passwordHash }).eq('id', userId);
  if (error) throw new Error(error.message);
}

module.exports = { createResetToken, sendResetEmail, consumeResetToken, setUserPassword };
