'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib/AuthContext';
import { useLanguage } from '../../lib/LanguageContext';
import DubaiBackdrop from '../../components/DubaiBackdrop';
import HandshakeMark from '../../components/HandshakeMark';

const STRINGS = {
  fa: {
    brand: 'Estatemate',
    eyebrow: 'نخستین سیستمِ اتوماسیونِ هوشمندِ املاک در دبی',
    headline: 'بستنِ قراردادهای بزرگ، هنرِ صبر و استمرار است. مسیرِ موفقیت را با نظم و آرامش طی کنید.',
    sub: 'تحلیلِ خودکارِ چت‌های واتساپ و تلگرام — هیچ مشتری و ملکی را از دست ندهید.',
    welcomeLogin: 'خوش اومدید',
    welcomeSignup: 'ساخت حساب جدید',
    welcomeForgot: 'بازیابی رمز عبور',
    subLogin: 'وارد حساب کاربری خودتون بشید',
    subSignup: 'برای شروع، یک حساب بسازید',
    subForgot: 'ایمیل حساب خود را وارد کنید تا لینک بازیابی برایتان ارسال شود',
    fullName: 'نام کامل',
    email: 'ایمیل',
    password: 'رمز عبور',
    submitLogin: 'ورود',
    submitSignup: 'ساخت حساب',
    submitForgot: 'ارسال لینک بازیابی',
    switchToSignup: 'حساب ندارید؟ ثبت‌نام کنید',
    switchToLogin: 'قبلاً حساب ساختید؟ وارد شوید',
    forgotLink: 'رمز عبور را فراموش کرده‌اید؟',
    backToLogin: '← بازگشت به ورود',
    submitting: 'در حال ارسال...',
    showPass: 'نمایش رمز',
    hidePass: 'پنهان کردن رمز',
    forgotSent: 'اگر این ایمیل ثبت شده باشد، لینک بازیابی برایتان ارسال شد. صندوق ورودی‌تان را بررسی کنید.',
  },
  en: {
    brand: 'Estatemate',
    eyebrow: 'Dubai’s first smart real-estate automation system',
    headline: 'Closing big deals is the art of patience and persistence. Walk the path to success with order and calm.',
    sub: 'Automatic analysis of WhatsApp & Telegram chats — never miss a client or a property again.',
    welcomeLogin: 'Welcome back',
    welcomeSignup: 'Create an account',
    welcomeForgot: 'Reset your password',
    subLogin: 'Sign in to your account',
    subSignup: 'Get started by creating an account',
    subForgot: 'Enter your account email and we’ll send you a reset link',
    fullName: 'Full name',
    email: 'Email',
    password: 'Password',
    submitLogin: 'Sign in',
    submitSignup: 'Create account',
    submitForgot: 'Send reset link',
    switchToSignup: "Don't have an account? Sign up",
    switchToLogin: 'Already have an account? Sign in',
    forgotLink: 'Forgot your password?',
    backToLogin: '← Back to sign in',
    submitting: 'Submitting...',
    showPass: 'Show password',
    hidePass: 'Hide password',
    forgotSent: 'If that email is registered, a reset link has been sent. Please check your inbox.',
  },
  ar: {
    brand: 'Estatemate',
    eyebrow: 'أول نظام أتمتة عقارية ذكي في دبي',
    headline: 'إبرام الصفقات الكبيرة فنُّ الصبر والمثابرة. اسلك طريق النجاح بنظامٍ وهدوء.',
    sub: 'تحليل تلقائي لمحادثات واتساب وتيليجرام — لا تفوّت أي عميل أو عقار بعد الآن.',
    welcomeLogin: 'مرحباً بعودتك',
    welcomeSignup: 'إنشاء حساب جديد',
    welcomeForgot: 'إعادة تعيين كلمة المرور',
    subLogin: 'سجّل الدخول إلى حسابك',
    subSignup: 'للبدء، أنشئ حسابًا',
    subForgot: 'أدخل بريد حسابك وسنرسل لك رابط إعادة التعيين',
    fullName: 'الاسم الكامل',
    email: 'البريد الإلكتروني',
    password: 'كلمة المرور',
    submitLogin: 'تسجيل الدخول',
    submitSignup: 'إنشاء الحساب',
    submitForgot: 'إرسال رابط إعادة التعيين',
    switchToSignup: 'ليس لديك حساب؟ سجّل الآن',
    switchToLogin: 'لديك حساب بالفعل؟ سجّل الدخول',
    forgotLink: 'هل نسيت كلمة المرور؟',
    backToLogin: '← العودة لتسجيل الدخول',
    submitting: 'جارٍ الإرسال...',
    showPass: 'إظهار كلمة المرور',
    hidePass: 'إخفاء كلمة المرور',
    forgotSent: 'إذا كان هذا البريد مسجلاً، فقد أُرسل رابط إعادة التعيين. يرجى التحقق من بريدك.',
  },
};

// Error messages by stable code, in each language, so the shown text matches
// the selected language rather than echoing the server string.
const ERRORS = {
  fa: {
    invalid_credentials: 'ایمیل یا رمز عبور اشتباه است.',
    email_taken: 'این ایمیل قبلاً ثبت شده است.',
    missing_fields: 'لطفاً همه‌ی فیلدها را پر کنید.',
    weak_password: 'رمز عبور باید حداقل ۶ کاراکتر باشد.',
    invalid_reset_token: 'لینک بازیابی نامعتبر یا منقضی شده است.',
    generic: 'خطایی رخ داد. دوباره تلاش کنید.',
  },
  en: {
    invalid_credentials: 'Wrong email or password.',
    email_taken: 'This email is already registered.',
    missing_fields: 'Please fill in all fields.',
    weak_password: 'Password must be at least 6 characters.',
    invalid_reset_token: 'The reset link is invalid or expired.',
    generic: 'Something went wrong. Please try again.',
  },
  ar: {
    invalid_credentials: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
    email_taken: 'هذا البريد الإلكتروني مسجّل بالفعل.',
    missing_fields: 'يرجى ملء جميع الحقول.',
    weak_password: 'يجب أن تكون كلمة المرور 6 أحرف على الأقل.',
    invalid_reset_token: 'رابط إعادة التعيين غير صالح أو منتهي الصلاحية.',
    generic: 'حدث خطأ ما. حاول مرة أخرى.',
  },
};

export function translateError(err, lang) {
  const table = ERRORS[lang] || ERRORS.fa;
  if (err && err.code) return table[err.code] || table.generic;
  return (err && err.message) || table.generic; // network/other: keep diagnostic
}

const EyeIcon = ({ off }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
    {off && <line x1="3" y1="3" x2="21" y2="21" />}
  </svg>
);

export default function LoginPage() {
  const { login, signup, forgotPassword, token, ready } = useAuth();
  const { lang, setLang } = useLanguage();
  const t = STRINGS[lang] || STRINGS.fa;
  const router = useRouter();

  const [mode, setMode] = useState('login'); // 'login' | 'signup' | 'forgot'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (ready && token) router.replace('/dashboard');
  }, [ready, token, router]);

  const switchMode = (next) => {
    setMode(next);
    setError('');
    setNotice('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      if (mode === 'login') {
        await login(email, password);
        router.replace('/dashboard');
      } else if (mode === 'signup') {
        await signup(email, password, fullName);
        router.replace('/dashboard');
      } else {
        await forgotPassword(email);
        setNotice(t.forgotSent);
      }
    } catch (err) {
      setError(translateError(err, lang));
    } finally {
      setSubmitting(false);
    }
  };

  const welcome = mode === 'login' ? t.welcomeLogin : mode === 'signup' ? t.welcomeSignup : t.welcomeForgot;
  const subtitle = mode === 'login' ? t.subLogin : mode === 'signup' ? t.subSignup : t.subForgot;
  const submitLabel = mode === 'login' ? t.submitLogin : mode === 'signup' ? t.submitSignup : t.submitForgot;

  return (
    <div className="login-screen">
      <div className="login-visual">
        <DubaiBackdrop variant="login" />
        <div className="brandmark">
          <div className="mark mark-handshake">
            <HandshakeMark />
          </div>
          <div className="name">{t.brand}</div>
        </div>
        <div className="pitch">
          <span className="eyebrow">{t.eyebrow}</span>
          <h1>{t.headline}</h1>
          <p>{t.sub}</p>
        </div>
        <div />
      </div>
      <div className="login-form-wrap">
        <div className="lang-switch" style={{ position: 'absolute', top: 20, insetInlineEnd: 20 }}>
          <button className={lang === 'fa' ? 'active' : ''} onClick={() => setLang('fa')} type="button">
            فارسی
          </button>
          <button className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')} type="button">
            English
          </button>
          <button className={lang === 'ar' ? 'active' : ''} onClick={() => setLang('ar')} type="button">
            العربية
          </button>
        </div>
        <form className="login-form" onSubmit={handleSubmit}>
          <h2>{welcome}</h2>
          <div className="sub">{subtitle}</div>

          {error && <div className="form-error">{error}</div>}
          {notice && <div className="form-notice">{notice}</div>}

          {mode === 'signup' && (
            <div className="field">
              <label htmlFor="fullName">{t.fullName}</label>
              <input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
          )}
          <div className="field">
            <label htmlFor="email">{t.email}</label>
            <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {mode !== 'forgot' && (
            <div className="field">
              <label htmlFor="password">{t.password}</label>
              <div className="password-field">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="pass-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? t.hidePass : t.showPass}
                  title={showPassword ? t.hidePass : t.showPass}
                >
                  <EyeIcon off={showPassword} />
                </button>
              </div>
            </div>
          )}

          {mode === 'login' && (
            <div style={{ textAlign: 'start', marginTop: -6, marginBottom: 6 }}>
              <button
                type="button"
                onClick={() => switchMode('forgot')}
                style={{ background: 'none', border: 'none', color: 'var(--accent-ink)', cursor: 'pointer', fontSize: 12.5, padding: 0 }}
              >
                {t.forgotLink}
              </button>
            </div>
          )}

          <button className="btn-primary" type="submit" disabled={submitting}>
            {submitting ? t.submitting : submitLabel}
          </button>

          <div className="fineprint">
            {mode === 'forgot' ? (
              <button
                type="button"
                onClick={() => switchMode('login')}
                style={{ background: 'none', border: 'none', color: 'var(--accent-ink)', cursor: 'pointer' }}
              >
                {t.backToLogin}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => switchMode(mode === 'login' ? 'signup' : 'login')}
                style={{ background: 'none', border: 'none', color: 'var(--accent-ink)', cursor: 'pointer' }}
              >
                {mode === 'login' ? t.switchToSignup : t.switchToLogin}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
