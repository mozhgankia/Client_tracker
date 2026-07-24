'use client';

// WhatsApp connection card — pairing-code flow (mobile-friendly, no QR):
//   phone_entry  → user types their WhatsApp number
//   pairing_pending → backend returns an 8-char code; user enters it in
//       WhatsApp → Linked devices → Link with phone number
//   connected → profile pic + phone + disconnect
// Talks to POST/GET /api/whatsapp/connect|status|disconnect, all of which read
// the tenant from the JWT, so this component only ever needs the token.

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiUrl } from '../lib/api';
import './WhatsAppConnection.css';

const STRINGS = {
  fa: {
    loading: 'در حال بررسی وضعیت اتصال...',
    phoneLabel: 'شماره واتساپ (با کد کشور)',
    phonePlaceholder: '۹۷۱xxxxxxxxx',
    phoneHint: 'مثال دبی: 9715xxxxxxxx — بدون + و بدون صفر ابتدایی',
    getCode: 'دریافت کد اتصال',
    codeTitle: 'کد اتصال شما',
    codeSteps: [
      'در گوشی، واتساپ را باز کنید',
      'تنظیمات ← دستگاه‌های متصل ← اتصال دستگاه',
      'روی «اتصال با شماره تلفن» بزنید',
      'این کد را وارد کنید 👇',
    ],
    waiting: 'در انتظار تأیید در واتساپ...',
    connectedTitle: 'به واتساپ وصل است',
    disconnect: 'قطع اتصال',
    disconnecting: 'در حال قطع اتصال...',
    submitting: 'در حال ارسال...',
    errorTitle: 'اتصال ناموفق بود',
    retry: 'شروع دوباره',
  },
  en: {
    loading: 'Checking connection status...',
    phoneLabel: 'WhatsApp number (with country code)',
    phonePlaceholder: '9715xxxxxxxx',
    phoneHint: 'e.g. Dubai 9715xxxxxxxx — no + and no leading zero',
    getCode: 'Get pairing code',
    codeTitle: 'Your pairing code',
    codeSteps: [
      'Open WhatsApp on your phone',
      'Settings → Linked devices → Link a device',
      'Tap “Link with phone number instead”',
      'Enter this code 👇',
    ],
    waiting: 'Waiting for confirmation in WhatsApp...',
    connectedTitle: 'Connected to WhatsApp',
    disconnect: 'Disconnect',
    disconnecting: 'Disconnecting...',
    submitting: 'Submitting...',
    errorTitle: 'Connection failed',
    retry: 'Start over',
  },
  ar: {
    loading: 'جارٍ التحقق من حالة الاتصال...',
    phoneLabel: 'رقم واتساب (مع رمز الدولة)',
    phonePlaceholder: '9715xxxxxxxx',
    phoneHint: 'مثال دبي: 9715xxxxxxxx — بدون + وبدون صفر البداية',
    getCode: 'الحصول على رمز الربط',
    codeTitle: 'رمز الربط الخاص بك',
    codeSteps: [
      'افتح واتساب على هاتفك',
      'الإعدادات ← الأجهزة المرتبطة ← ربط جهاز',
      'اضغط «الربط برقم الهاتف بدلاً من ذلك»',
      'أدخل هذا الرمز 👇',
    ],
    waiting: 'في انتظار التأكيد في واتساب...',
    connectedTitle: 'متصل بواتساب',
    disconnect: 'قطع الاتصال',
    disconnecting: 'جارٍ قطع الاتصال...',
    submitting: 'جارٍ الإرسال...',
    errorTitle: 'فشل الاتصال',
    retry: 'البدء من جديد',
  },
};

const POLL_INTERVAL_MS = 3000;

async function apiGet(path, authToken) {
  const res = await fetch(apiUrl(path), { mode: 'cors', headers: { Authorization: `Bearer ${authToken}` } });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `درخواست ${path} شکست خورد`);
  return body;
}

async function apiPost(path, body, authToken) {
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    mode: 'cors',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `درخواست ${path} شکست خورد`);
  return data;
}

export default function WhatsAppConnection({ authToken, lang = 'fa' }) {
  const t = STRINGS[lang] || STRINGS.fa;
  const [phase, setPhase] = useState('loading'); // loading | phone_entry | pairing_pending | connected | error
  const [info, setInfo] = useState(null);
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [disconnecting, setDisconnecting] = useState(false);
  const pollRef = useRef(null);

  const applyInfo = useCallback((data) => {
    setInfo(data);
    setPhase(data.status === 'disconnected' ? 'phone_entry' : data.status);
    setErrorMessage(data.error || '');
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      applyInfo(await apiGet('/api/whatsapp/status', authToken));
    } catch (err) {
      setPhase('error');
      setErrorMessage(err.message);
    }
  }, [authToken, applyInfo]);

  const handleGetCode = useCallback(
    async (e) => {
      e.preventDefault();
      setSubmitting(true);
      setErrorMessage('');
      try {
        const digits = phone.replace(/[^0-9]/g, '');
        applyInfo(await apiPost('/api/whatsapp/connect', { phone: digits }, authToken));
      } catch (err) {
        setPhase('error');
        setErrorMessage(err.message);
      } finally {
        setSubmitting(false);
      }
    },
    [phone, authToken, applyInfo]
  );

  const handleDisconnect = useCallback(async () => {
    setDisconnecting(true);
    try {
      applyInfo(await apiPost('/api/whatsapp/disconnect', {}, authToken));
      setPhone('');
    } catch (err) {
      setPhase('error');
      setErrorMessage(err.message);
    } finally {
      setDisconnecting(false);
    }
  }, [authToken, applyInfo]);

  useEffect(() => {
    fetchStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While a pairing code is showing (or mid-handshake), poll until it links.
  useEffect(() => {
    if (phase === 'pairing_pending' || phase === 'connecting') {
      pollRef.current = setInterval(fetchStatus, POLL_INTERVAL_MS);
      return () => clearInterval(pollRef.current);
    }
  }, [phase, fetchStatus]);

  if (phase === 'loading' || phase === 'connecting') {
    return (
      <div className="wa-card">
        <div className="wa-spinner" aria-hidden="true" />
        <p>{t.loading}</p>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="wa-card wa-card--error">
        <p className="wa-error-title">{t.errorTitle}</p>
        <p className="wa-error-message">{errorMessage}</p>
        <button className="btn accent" onClick={() => setPhase('phone_entry')}>
          {t.retry}
        </button>
      </div>
    );
  }

  if (phase === 'phone_entry') {
    return (
      <form className="wa-card" onSubmit={handleGetCode}>
        <div className="wa-brandrow">
          <span className="wa-logo" aria-hidden="true">💬</span>
          <strong>WhatsApp</strong>
        </div>
        <label className="wa-label" htmlFor="wa-phone">
          {t.phoneLabel}
        </label>
        <input
          id="wa-phone"
          className="wa-input tabular"
          type="tel"
          required
          placeholder={t.phonePlaceholder}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <p className="wa-hint">{t.phoneHint}</p>
        <button className="btn accent" type="submit" disabled={submitting}>
          {submitting ? t.submitting : t.getCode}
        </button>
      </form>
    );
  }

  if (phase === 'pairing_pending') {
    return (
      <div className="wa-card">
        <p className="wa-title">{t.codeTitle}</p>
        <ol className="wa-steps">
          {t.codeSteps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
        <div className="wa-pairing-code tabular">{info?.pairingCode || '••••••••'}</div>
        <p className="wa-countdown">{t.waiting}</p>
      </div>
    );
  }

  if (phase === 'connected') {
    return (
      <div className="wa-card wa-card--connected">
        {info?.profilePictureUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={info.profilePictureUrl} alt="" className="wa-avatar" />
        ) : (
          <div className="wa-avatar wa-avatar--placeholder" aria-hidden="true" />
        )}
        <p className="wa-title">{t.connectedTitle}</p>
        {info?.phone && <p className="wa-phone tabular">{info.phone}</p>}
        <button className="btn" onClick={handleDisconnect} disabled={disconnecting}>
          {disconnecting ? t.disconnecting : t.disconnect}
        </button>
      </div>
    );
  }

  return null;
}
