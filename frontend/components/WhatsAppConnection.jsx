'use client';

// WhatsApp connection card: loading -> qr_pending (with expiry countdown) ->
// connected (profile pic + phone + disconnect) -> error (message + retry).
// Talks to POST/GET /api/whatsapp/connect|status|disconnect on the backend,
// all of which read the tenant from the JWT (see backend/src/auth), so this
// component only ever needs the token — never a userId.
//
// Styling reuses the design tokens (--surface, --accent, --border, etc.)
// established in the Phase 1 dashboard mockup, so it drops into the same
// visual system without redefining colors here.

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiUrl } from '../lib/api';
import './WhatsAppConnection.css';

const STRINGS = {
  fa: {
    loading: 'در حال بررسی وضعیت اتصال...',
    scanTitle: 'برای اتصال، این کد را با واتساپ اسکن کنید',
    scanHint: 'واتساپ > تنظیمات > دستگاه‌های متصل > اتصال دستگاه',
    expiresIn: (s) => `این کد تا ${s} ثانیه‌ی دیگر منقضی می‌شود`,
    regenerating: 'در حال ساخت کد تازه...',
    connectedTitle: 'به واتساپ وصل است',
    disconnect: 'قطع اتصال',
    disconnecting: 'در حال قطع اتصال...',
    errorTitle: 'اتصال ناموفق بود',
    retry: 'تلاش مجدد',
  },
  en: {
    loading: 'Checking connection status...',
    scanTitle: 'Scan this code with WhatsApp to connect',
    scanHint: 'WhatsApp > Settings > Linked devices > Link a device',
    expiresIn: (s) => `This code expires in ${s}s`,
    regenerating: 'Generating a new code...',
    connectedTitle: 'Connected to WhatsApp',
    disconnect: 'Disconnect',
    disconnecting: 'Disconnecting...',
    errorTitle: 'Connection failed',
    retry: 'Retry',
  },
  ar: {
    loading: 'جارٍ التحقق من حالة الاتصال...',
    scanTitle: 'امسح هذا الرمز عبر واتساب للاتصال',
    scanHint: 'واتساب > الإعدادات > الأجهزة المرتبطة > ربط جهاز',
    expiresIn: (s) => `تنتهي صلاحية هذا الرمز خلال ${s} ثانية`,
    regenerating: 'جارٍ إنشاء رمز جديد...',
    connectedTitle: 'متصل بواتساب',
    disconnect: 'قطع الاتصال',
    disconnecting: 'جارٍ قطع الاتصال...',
    errorTitle: 'فشل الاتصال',
    retry: 'إعادة المحاولة',
  },
};

const POLL_INTERVAL_MS = 3000;

async function apiCall(path, method, authToken) {
  const res = await fetch(apiUrl(path), {
    method,
    mode: 'cors',
    headers: { Authorization: `Bearer ${authToken}` },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `درخواست ${path} شکست خورد`);
  return body;
}

/**
 * @param {{ authToken: string, lang?: 'fa'|'en'|'ar' }} props
 */
export default function WhatsAppConnection({ authToken, lang = 'fa' }) {
  const t = STRINGS[lang] || STRINGS.fa;
  const [info, setInfo] = useState(null); // last response from the backend
  const [phase, setPhase] = useState('loading'); // loading | qr_pending | connected | disconnected | error
  const [errorMessage, setErrorMessage] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const pollRef = useRef(null);

  const applyInfo = useCallback((data) => {
    setInfo(data);
    setPhase(data.status);
    setErrorMessage(data.error || '');
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await apiCall('/api/whatsapp/status', 'GET', authToken);
      applyInfo(data);
    } catch (err) {
      setPhase('error');
      setErrorMessage(err.message);
    }
  }, [authToken, applyInfo]);

  const startConnection = useCallback(async () => {
    setPhase('loading');
    try {
      const data = await apiCall('/api/whatsapp/connect', 'POST', authToken);
      applyInfo(data);
    } catch (err) {
      setPhase('error');
      setErrorMessage(err.message);
    }
  }, [authToken, applyInfo]);

  const handleDisconnect = useCallback(async () => {
    setDisconnecting(true);
    try {
      const data = await apiCall('/api/whatsapp/disconnect', 'POST', authToken);
      applyInfo(data);
    } catch (err) {
      setPhase('error');
      setErrorMessage(err.message);
    } finally {
      setDisconnecting(false);
    }
  }, [authToken, applyInfo]);

  // Initial load: check current status, then connect if nothing is active yet.
  useEffect(() => {
    (async () => {
      await fetchStatus();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase === 'disconnected') startConnection();
  }, [phase, startConnection]);

  // Poll while a QR is pending or we're mid-handshake — either could resolve
  // to "connected" the moment the user finishes scanning.
  useEffect(() => {
    if (phase === 'qr_pending' || phase === 'connecting') {
      pollRef.current = setInterval(fetchStatus, POLL_INTERVAL_MS);
      return () => clearInterval(pollRef.current);
    }
  }, [phase, fetchStatus]);

  // QR expiry countdown.
  useEffect(() => {
    if (phase !== 'qr_pending' || !info?.qrExpiresAt) {
      setSecondsLeft(null);
      return;
    }
    const tick = () => {
      const remaining = Math.max(0, Math.round((new Date(info.qrExpiresAt).getTime() - Date.now()) / 1000));
      setSecondsLeft(remaining);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [phase, info?.qrExpiresAt]);

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
        <button className="btn accent" onClick={startConnection}>
          {t.retry}
        </button>
      </div>
    );
  }

  if (phase === 'qr_pending') {
    return (
      <div className="wa-card">
        <p className="wa-title">{t.scanTitle}</p>
        {info?.qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={info.qr} alt="WhatsApp QR" className="wa-qr" />
        ) : (
          <p>{t.regenerating}</p>
        )}
        <p className="wa-hint">{t.scanHint}</p>
        {secondsLeft != null && (
          <p className="wa-countdown tabular">
            {secondsLeft > 0 ? t.expiresIn(secondsLeft) : t.regenerating}
          </p>
        )}
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
