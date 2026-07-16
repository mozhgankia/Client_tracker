// Phone/code/2FA-password login handshake, broken into three separate steps
// so a frontend can drive it over plain request/response calls (unlike
// GramJS/teleproto's built-in `client.start()`, which expects synchronous
// callbacks and blocks for the whole flow — awkward across HTTP requests).
// The in-progress client is kept in memory between steps and only handed
// off to listener.js once fully authorized.
'use strict';

const { TelegramClient, Api } = require('teleproto');
const { StringSession } = require('teleproto/sessions');
const { computeCheck } = require('teleproto/Password');

const { saveSessionString } = require('./sessionStore');
const { startTelegramListener } = require('./listener');

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;
const PENDING_TTL_MS = 5 * 60 * 1000; // abandon a half-finished login after 5 minutes

// userId -> { client, phone, phoneCodeHash, expiresAt }
const pendingLogins = new Map();

function assertConfigured() {
  if (!apiId || !apiHash) throw new Error('TELEGRAM_API_ID و TELEGRAM_API_HASH تنظیم نشده‌اند.');
}

function clearPending(userId) {
  const pending = pendingLogins.get(userId);
  if (!pending) return;
  pending.client.disconnect().catch(() => {});
  pendingLogins.delete(userId);
}

function getPendingOrThrow(userId) {
  const pending = pendingLogins.get(userId);
  if (!pending || pending.expiresAt < Date.now()) {
    clearPending(userId);
    throw new Error('نشست ورود منقضی شده — دوباره شماره تلفن را وارد کنید.');
  }
  return pending;
}

/** Step 1: send the phone number, Telegram texts/app-sends a login code. */
async function startPhoneLogin(userId, phone) {
  assertConfigured();
  clearPending(userId); // drop any abandoned previous attempt for this tenant

  const client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 5 });
  await client.connect();

  const { phoneCodeHash } = await client.sendCode({ apiId, apiHash }, phone);
  pendingLogins.set(userId, { client, phone, phoneCodeHash, expiresAt: Date.now() + PENDING_TTL_MS });
  return { status: 'code_pending' };
}

/** Step 2: submit the code Telegram sent. May resolve straight to
 * 'connected', or to 'password_pending' if the account has 2FA enabled. */
async function submitCode(userId, code) {
  const pending = getPendingOrThrow(userId);

  try {
    await pending.client.invoke(
      new Api.auth.SignIn({ phoneNumber: pending.phone, phoneCodeHash: pending.phoneCodeHash, phoneCode: code })
    );
    return finishLogin(userId, pending.client);
  } catch (err) {
    if (err.errorMessage === 'SESSION_PASSWORD_NEEDED') {
      return { status: 'password_pending' };
    }
    clearPending(userId);
    throw new Error(`کد وارد شده نامعتبر یا منقضی‌شده است: ${err.message}`);
  }
}

/** Step 3 (only if the account has 2FA): submit the cloud password. */
async function submitPassword(userId, password) {
  const pending = getPendingOrThrow(userId);

  try {
    const passwordInfo = await pending.client.invoke(new Api.account.GetPassword());
    const passwordCheck = await computeCheck(passwordInfo, password);
    await pending.client.invoke(new Api.auth.CheckPassword({ password: passwordCheck }));
    return finishLogin(userId, pending.client);
  } catch (err) {
    clearPending(userId);
    throw new Error(`رمز دومرحله‌ای اشتباه است: ${err.message}`);
  }
}

async function finishLogin(userId, client) {
  const sessionString = client.session.save();
  await saveSessionString(userId, sessionString);
  await client.disconnect().catch(() => {}); // listener.js opens its own connection from the saved session
  pendingLogins.delete(userId);
  await startTelegramListener(userId);
  return { status: 'connected' };
}

module.exports = { startPhoneLogin, submitCode, submitPassword };
