// One-time interactive login: run this locally (never on the free-tier
// server) to create a GramJS session for a tenant. It asks for the phone
// number, the code Telegram texts/sends in-app, and the 2FA password if the
// account has one — then saves the resulting session string to Supabase so
// the always-on listener (listener.js) can pick it up without ever touching
// local disk.
//
// Usage: TENANT_USER_ID=<uuid> node src/telegram/login.js
'use strict';

const { TelegramClient } = require('teleproto');
const { StringSession } = require('teleproto/sessions');
const input = require('input');
const { saveSessionString } = require('./sessionStore');

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;
const userId = process.env.TENANT_USER_ID;

if (!apiId || !apiHash) {
  console.error('TELEGRAM_API_ID و TELEGRAM_API_HASH را از my.telegram.org بگیرید و تنظیم کنید.');
  process.exit(1);
}
if (!userId) {
  console.error('TENANT_USER_ID (شناسه‌ی کاربر در جدول users) را تنظیم کنید.');
  process.exit(1);
}

async function main() {
  const client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 5 });

  await client.start({
    phoneNumber: async () => input.text('شماره تلفن (با کد کشور، مثلاً +9891...): '),
    password: async () => input.text('رمز دو مرحله‌ای (اگر فعال است، وگرنه خالی بگذارید): '),
    phoneCode: async () => input.text('کدی که تلگرام فرستاد: '),
    onError: (err) => console.error(err),
  });

  const sessionString = client.session.save();
  await saveSessionString(userId, sessionString);
  console.log('نشست تلگرام با موفقیت در Supabase ذخیره شد. حالا listener.js می‌تواند بدون این اسکریپت وصل بشه.');
  await client.disconnect();
}

main().catch((err) => {
  console.error('ورود به تلگرام شکست خورد:', err.message);
  process.exit(1);
});
