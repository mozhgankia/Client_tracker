'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib/AuthContext';
import { useLanguage } from '../../lib/LanguageContext';
import { translateError } from '../login/page';

const STRINGS = {
  fa: {
    title: 'تنظیم رمز عبور جدید',
    sub: 'یک رمز عبور جدید برای حساب خود انتخاب کنید.',
    password: 'رمز عبور جدید',
    submit: 'ذخیره رمز جدید',
    submitting: 'در حال ذخیره...',
    done: 'رمز عبور شما با موفقیت تغییر کرد. در حال انتقال به صفحه ورود...',
    noToken: 'لینک بازیابی نامعتبر است. لطفاً دوباره درخواست دهید.',
    backToLogin: '← بازگشت به ورود',
    show: 'نمایش رمز',
    hide: 'پنهان کردن رمز',
  },
  en: {
    title: 'Set a new password',
    sub: 'Choose a new password for your account.',
    password: 'New password',
    submit: 'Save new password',
    submitting: 'Saving...',
    done: 'Your password has been changed. Redirecting to sign in...',
    noToken: 'The reset link is invalid. Please request a new one.',
    backToLogin: '← Back to sign in',
    show: 'Show password',
    hide: 'Hide password',
  },
  ar: {
    title: 'تعيين كلمة مرور جديدة',
    sub: 'اختر كلمة مرور جديدة لحسابك.',
    password: 'كلمة المرور الجديدة',
    submit: 'حفظ كلمة المرور',
    submitting: 'جارٍ الحفظ...',
    done: 'تم تغيير كلمة المرور بنجاح. جارٍ التحويل لتسجيل الدخول...',
    noToken: 'رابط إعادة التعيين غير صالح. يرجى طلب رابط جديد.',
    backToLogin: '← العودة لتسجيل الدخول',
    show: 'إظهار كلمة المرور',
    hide: 'إخفاء كلمة المرور',
  },
};

export default function ResetPasswordPage() {
  const { resetPassword } = useAuth();
  const { lang } = useLanguage();
  const t = STRINGS[lang] || STRINGS.fa;
  const router = useRouter();

  const [tokenReady, setTokenReady] = useState(false);
  const [tokenValue, setTokenValue] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setTokenValue(params.get('token') || '');
    setTokenReady(true);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await resetPassword(tokenValue, password);
      setDone(true);
      setTimeout(() => router.replace('/login'), 2200);
    } catch (err) {
      setError(translateError(err, lang));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-form-wrap" style={{ minHeight: '100vh' }}>
      <form className="login-form" onSubmit={handleSubmit}>
        <h2>{t.title}</h2>
        <div className="sub">{t.sub}</div>

        {error && <div className="form-error">{error}</div>}
        {done && <div className="form-notice">{t.done}</div>}
        {tokenReady && !tokenValue && <div className="form-error">{t.noToken}</div>}

        {tokenValue && !done && (
          <>
            <div className="field">
              <label htmlFor="password">{t.password}</label>
              <div className="password-field">
                <input
                  id="password"
                  type={show ? 'text' : 'password'}
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="pass-toggle"
                  onClick={() => setShow((v) => !v)}
                  aria-label={show ? t.hide : t.show}
                  title={show ? t.hide : t.show}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                    <circle cx="12" cy="12" r="3" />
                    {show && <line x1="3" y1="3" x2="21" y2="21" />}
                  </svg>
                </button>
              </div>
            </div>
            <button className="btn-primary" type="submit" disabled={submitting}>
              {submitting ? t.submitting : t.submit}
            </button>
          </>
        )}

        <div className="fineprint">
          <a href="/login" style={{ color: 'var(--accent-ink)' }}>{t.backToLogin}</a>
        </div>
      </form>
    </div>
  );
}
