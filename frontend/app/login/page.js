'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib/AuthContext';
import { useLanguage } from '../../lib/LanguageContext';
import DubaiBackdrop from '../../components/DubaiBackdrop';

const STRINGS = {
  fa: {
    brand: 'Estatemate',
    eyebrow: 'نخستین سیستمِ اتوماسیونِ هوشمندِ املاک در دبی',
    headline: 'بستنِ قراردادهای بزرگ، هنرِ صبر و استمرار است. مسیرِ موفقیت را با نظم و آرامش طی کنید.',
    sub: 'تحلیلِ خودکارِ چت‌های واتساپ و تلگرام — هیچ مشتری و ملکی را از دست ندهید.',
    welcomeLogin: 'خوش اومدید',
    welcomeSignup: 'ساخت حساب جدید',
    subLogin: 'وارد حساب کاربری خودتون بشید',
    subSignup: 'برای شروع، یک حساب بسازید',
    fullName: 'نام کامل',
    email: 'ایمیل',
    password: 'رمز عبور',
    submitLogin: 'ورود',
    submitSignup: 'ساخت حساب',
    switchToSignup: 'حساب ندارید؟ ثبت‌نام کنید',
    switchToLogin: 'قبلاً حساب ساختید؟ وارد شوید',
    submitting: 'در حال ارسال...',
  },
  en: {
    brand: 'Estatemate',
    eyebrow: 'Dubai’s first smart real-estate automation system',
    headline: 'Closing big deals is the art of patience and persistence. Walk the path to success with order and calm.',
    sub: 'Automatic analysis of WhatsApp & Telegram chats — never miss a client or a property again.',
    welcomeLogin: 'Welcome back',
    welcomeSignup: 'Create an account',
    subLogin: 'Sign in to your account',
    subSignup: 'Get started by creating an account',
    fullName: 'Full name',
    email: 'Email',
    password: 'Password',
    submitLogin: 'Sign in',
    submitSignup: 'Create account',
    switchToSignup: "Don't have an account? Sign up",
    switchToLogin: 'Already have an account? Sign in',
    submitting: 'Submitting...',
  },
  ar: {
    brand: 'Estatemate',
    eyebrow: 'أول نظام أتمتة عقارية ذكي في دبي',
    headline: 'إبرام الصفقات الكبيرة فنُّ الصبر والمثابرة. اسلك طريق النجاح بنظامٍ وهدوء.',
    sub: 'تحليل تلقائي لمحادثات واتساب وتيليجرام — لا تفوّت أي عميل أو عقار بعد الآن.',
    welcomeLogin: 'مرحباً بعودتك',
    welcomeSignup: 'إنشاء حساب جديد',
    subLogin: 'سجّل الدخول إلى حسابك',
    subSignup: 'للبدء، أنشئ حسابًا',
    fullName: 'الاسم الكامل',
    email: 'البريد الإلكتروني',
    password: 'كلمة المرور',
    submitLogin: 'تسجيل الدخول',
    submitSignup: 'إنشاء الحساب',
    switchToSignup: 'ليس لديك حساب؟ سجّل الآن',
    switchToLogin: 'لديك حساب بالفعل؟ سجّل الدخول',
    submitting: 'جارٍ الإرسال...',
  },
};

export default function LoginPage() {
  const { login, signup, token, ready } = useAuth();
  const { lang, setLang } = useLanguage();
  const t = STRINGS[lang] || STRINGS.fa;
  const router = useRouter();

  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (ready && token) router.replace('/dashboard');
  }, [ready, token, router]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      if (mode === 'login') await login(email, password);
      else await signup(email, password, fullName);
      router.replace('/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-visual">
        <DubaiBackdrop variant="login" />
        <div className="brandmark">
          <div className="mark">E</div>
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
          <h2>{mode === 'login' ? t.welcomeLogin : t.welcomeSignup}</h2>
          <div className="sub">{mode === 'login' ? t.subLogin : t.subSignup}</div>

          {error && <div className="form-error">{error}</div>}

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
          <div className="field">
            <label htmlFor="password">{t.password}</label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button className="btn-primary" type="submit" disabled={submitting}>
            {submitting ? t.submitting : mode === 'login' ? t.submitLogin : t.submitSignup}
          </button>
          <div className="fineprint">
            <button
              type="button"
              onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
              style={{ background: 'none', border: 'none', color: 'var(--accent-ink)', cursor: 'pointer' }}
            >
              {mode === 'login' ? t.switchToSignup : t.switchToLogin}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
