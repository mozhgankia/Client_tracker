'use client';

// Telegram connection card: phone entry -> code entry -> (optional) 2FA
// password entry -> connected -> error. Mirrors the state-machine shape of
// WhatsAppConnection.jsx, but Telegram's handshake needs typed input at each
// step (phone, code, password) instead of a single QR scan, so this talks to
// three sequential endpoints instead of one:
//   POST /api/telegram/connect          { phone }    -> code_pending
//   POST /api/telegram/verify-code      { code }     -> connected | password_pending
//   POST /api/telegram/verify-password  { password } -> connected
// All three, plus GET/POST .../status and .../disconnect, read the tenant
// from the JWT (see backend/src/auth) — this component only ever needs the
// token, never a userId.

import { useCallback, useEffect, useState } from 'react';
import { apiUrl } from '../lib/api';
import './TelegramConnection.css';

const STRINGS = {
  fa: {
    loading: 'در حال بررسی وضعیت اتصال...',
    phoneLabel: 'شماره تلفن تلگرام',
    phonePlaceholder: '+9891xxxxxxxx',
    phoneHint: 'با کد کشور وارد کنید',
    sendCode: 'ارسال کد',
    codeLabel: 'کدی که تلگرام فرستاد',
    codeHint: (phone) => `کد به ${phone} فرستاده شد`,
    verifyCode: 'تأیید کد',
    passwordLabel: 'رمز دومرحله‌ای',
    passwordHint: 'این اکانت رمز دومرحله‌ای (Cloud Password) فعال دارد',
    verifyPassword: 'تأیید رمز',
    submitting: 'در حال ارسال...',
    connectedTitle: 'به تلگرام وصل است',
    disconnect: 'قطع اتصال',
    disconnecting: 'در حال قطع اتصال...',
    errorTitle: 'اتصال ناموفق بود',
    retry: 'شروع دوباره',
  },
  en: {
    loading: 'Checking connection status...',
    phoneLabel: 'Telegram phone number',
    phonePlaceholder: '+1xxxxxxxxxx',
    phoneHint: 'Include the country code',
    sendCode: 'Send code',
    codeLabel: 'Code Telegram sent you',
    codeHint: (phone) => `A code was sent to ${phone}`,
    verifyCode: 'Verify code',
    passwordLabel: 'Two-factor password',
    passwordHint: 'This account has Cloud Password (2FA) enabled',
    verifyPassword: 'Verify password',
    submitting: 'Submitting...',
    connectedTitle: 'Connected to Telegram',
    disconnect: 'Disconnect',
    disconnecting: 'Disconnecting...',
    errorTitle: 'Connection failed',
    retry: 'Start over',
  },
  ar: {
    loading: 'جارٍ التحقق من حالة الاتصال...',
    phoneLabel: 'رقم هاتف تيليجرام',
    phonePlaceholder: '+9715xxxxxxx',
    phoneHint: 'أدخله مع رمز الدولة',
    sendCode: 'إرسال الرمز',
    codeLabel: 'الرمز الذي أرسله تيليجرام',
    codeHint: (phone) => `تم إرسال رمز إلى ${phone}`,
    verifyCode: 'تأكيد الرمز',
    passwordLabel: 'كلمة مرور التحقق بخطوتين',
    passwordHint: 'هذا الحساب مفعّل عليه التحقق بخطوتين',
    verifyPassword: 'تأكيد كلمة المرور',
    submitting: 'جارٍ الإرسال...',
    connectedTitle: 'متصل بتيليجرام',
    disconnect: 'قطع الاتصال',
    disconnecting: 'جارٍ قطع الاتصال...',
    errorTitle: 'فشل الاتصال',
    retry: 'البدء من جديد',
  },
};

async function apiCall(path, body, authToken) {
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `درخواست ${path} شکست خورد`);
  return data;
}

async function apiGet(path, authToken) {
  const res = await fetch(apiUrl(path), {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `درخواست ${path} شکست خورد`);
  return data;
}

/**
 * @param {{ authToken: string, lang?: 'fa'|'en'|'ar' }} props
 */
export default function TelegramConnection({ authToken, lang = 'fa' }) {
  const t = STRINGS[lang] || STRINGS.fa;
  const [phase, setPhase] = useState('loading'); // loading | phone_entry | code_entry | password_entry | connected | error
  const [info, setInfo] = useState(null);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await apiGet('/api/telegram/status', authToken);
        setInfo(data);
        setPhase(data.status === 'connected' ? 'connected' : 'phone_entry');
      } catch (err) {
        setErrorMessage(err.message);
        setPhase('error');
      }
    })();
  }, [authToken]);

  const handleSendCode = useCallback(
    async (e) => {
      e.preventDefault();
      setSubmitting(true);
      try {
        const data = await apiCall('/api/telegram/connect', { phone }, authToken);
        if (data.status === 'code_pending') setPhase('code_entry');
        else if (data.status === 'connected') {
          setInfo(data);
          setPhase('connected');
        }
      } catch (err) {
        setErrorMessage(err.message);
        setPhase('error');
      } finally {
        setSubmitting(false);
      }
    },
    [phone, authToken]
  );

  const handleVerifyCode = useCallback(
    async (e) => {
      e.preventDefault();
      setSubmitting(true);
      try {
        const data = await apiCall('/api/telegram/verify-code', { code }, authToken);
        if (data.status === 'password_pending') setPhase('password_entry');
        else if (data.status === 'connected') {
          setInfo(data);
          setPhase('connected');
        }
      } catch (err) {
        setErrorMessage(err.message);
        setPhase('error');
      } finally {
        setSubmitting(false);
      }
    },
    [code, authToken]
  );

  const handleVerifyPassword = useCallback(
    async (e) => {
      e.preventDefault();
      setSubmitting(true);
      try {
        const data = await apiCall('/api/telegram/verify-password', { password }, authToken);
        setInfo(data);
        setPhase('connected');
      } catch (err) {
        setErrorMessage(err.message);
        setPhase('error');
      } finally {
        setSubmitting(false);
      }
    },
    [password, authToken]
  );

  const handleDisconnect = useCallback(async () => {
    setDisconnecting(true);
    try {
      await apiCall('/api/telegram/disconnect', {}, authToken);
      setPhone('');
      setCode('');
      setPassword('');
      setPhase('phone_entry');
    } catch (err) {
      setErrorMessage(err.message);
      setPhase('error');
    } finally {
      setDisconnecting(false);
    }
  }, [authToken]);

  const handleRetry = useCallback(() => {
    setCode('');
    setPassword('');
    setErrorMessage('');
    setPhase('phone_entry');
  }, []);

  if (phase === 'loading') {
    return (
      <div className="tg-card">
        <div className="tg-spinner" aria-hidden="true" />
        <p>{t.loading}</p>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="tg-card tg-card--error">
        <p className="tg-error-title">{t.errorTitle}</p>
        <p className="tg-error-message">{errorMessage}</p>
        <button className="btn accent" onClick={handleRetry}>
          {t.retry}
        </button>
      </div>
    );
  }

  if (phase === 'phone_entry') {
    return (
      <form className="tg-card" onSubmit={handleSendCode}>
        <label className="tg-label" htmlFor="tg-phone">
          {t.phoneLabel}
        </label>
        <input
          id="tg-phone"
          className="tg-input tabular"
          type="tel"
          required
          placeholder={t.phonePlaceholder}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <p className="tg-hint">{t.phoneHint}</p>
        <button className="btn accent" type="submit" disabled={submitting}>
          {submitting ? t.submitting : t.sendCode}
        </button>
      </form>
    );
  }

  if (phase === 'code_entry') {
    return (
      <form className="tg-card" onSubmit={handleVerifyCode}>
        <label className="tg-label" htmlFor="tg-code">
          {t.codeLabel}
        </label>
        <input
          id="tg-code"
          className="tg-input tabular"
          type="text"
          inputMode="numeric"
          required
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <p className="tg-hint">{t.codeHint(phone)}</p>
        <button className="btn accent" type="submit" disabled={submitting}>
          {submitting ? t.submitting : t.verifyCode}
        </button>
      </form>
    );
  }

  if (phase === 'password_entry') {
    return (
      <form className="tg-card" onSubmit={handleVerifyPassword}>
        <label className="tg-label" htmlFor="tg-password">
          {t.passwordLabel}
        </label>
        <input
          id="tg-password"
          className="tg-input"
          type="password"
          required
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p className="tg-hint">{t.passwordHint}</p>
        <button className="btn accent" type="submit" disabled={submitting}>
          {submitting ? t.submitting : t.verifyPassword}
        </button>
      </form>
    );
  }

  if (phase === 'connected') {
    return (
      <div className="tg-card tg-card--connected">
        <p className="tg-title">{t.connectedTitle}</p>
        {info?.phone && <p className="tg-phone tabular">{info.phone}</p>}
        {info?.username && <p className="tg-username">@{info.username}</p>}
        <button className="btn" onClick={handleDisconnect} disabled={disconnecting}>
          {disconnecting ? t.disconnecting : t.disconnect}
        </button>
      </div>
    );
  }

  return null;
}
