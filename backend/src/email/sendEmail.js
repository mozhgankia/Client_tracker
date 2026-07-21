// Tiny email helper. Uses Resend (https://resend.com) when RESEND_API_KEY is
// set — a free tier that works from a stateless server with just an API key,
// no SMTP. When no key is configured (e.g. local dev), it logs the message
// instead of failing, so the surrounding flow still works end to end.
'use strict';

async function sendEmail({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'Estatemate <onboarding@resend.dev>';

  if (!apiKey) {
    console.log(`[email] RESEND_API_KEY تنظیم نشده — ایمیل ارسال نشد. گیرنده: ${to} | موضوع: ${subject}`);
    if (text) console.log(`[email] متن:\n${text}`);
    return { sent: false, reason: 'no_api_key' };
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html, text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ارسال ایمیل شکست خورد (${res.status}): ${body}`);
  }
  return { sent: true };
}

module.exports = { sendEmail };
