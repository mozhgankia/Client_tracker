'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../lib/AuthContext';
import { useLanguage } from '../../lib/LanguageContext';
import { apiFetch } from '../../lib/api';
import { fileToAvatarDataUrl } from '../../lib/image';
import HandshakeMark from '../../components/HandshakeMark';

// Downtown Dubai photo used as the user's profile picture (Unsplash License:
// free for commercial use). Square crop for the round avatar; falls back to
// initials if it can't load.
const PROFILE_PHOTO_URL =
  'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?auto=format&fit=crop&w=256&h=256&q=80';

const STRINGS = {
  fa: {
    brand: 'Estatemate',
    today: 'پیگیری امروز',
    customers: 'مشتری‌ها',
    properties: 'ملک‌ها',
    leads: 'لیدهای تازه',
    classification: 'دسته‌بندی',
    import: 'ورود چت‌ها',
    connections: 'اتصالات',
    settings: 'تنظیمات',
    role: 'مشاور املاک',
    uploadPhoto: 'آپلود عکس پروفایل',
    logout: 'خروج',
  },
  en: {
    brand: 'Estatemate',
    today: 'Today',
    customers: 'Clients',
    properties: 'Properties',
    leads: 'New leads',
    classification: 'Classification',
    import: 'Import chats',
    connections: 'Connections',
    settings: 'Settings',
    role: 'Real estate agent',
    uploadPhoto: 'Upload profile photo',
    logout: 'Log out',
  },
  ar: {
    brand: 'Estatemate',
    today: 'اليوم',
    customers: 'العملاء',
    properties: 'العقارات',
    leads: 'عملاء محتملون جدد',
    classification: 'التصنيف',
    import: 'استيراد المحادثات',
    connections: 'الاتصالات',
    settings: 'الإعدادات',
    role: 'وسيط عقاري',
    uploadPhoto: 'تحميل صورة الملف الشخصي',
    logout: 'تسجيل الخروج',
  },
};

const NAV_ITEMS = [
  { href: '/dashboard', key: 'today', icon: '☀' },
  { href: '/dashboard/customers', key: 'customers', icon: '◇' },
  { href: '/dashboard/properties', key: 'properties', icon: '▲' },
  { href: '/dashboard/leads', key: 'leads', icon: '◆' },
  { href: '/dashboard/classification', key: 'classification', icon: '🧠' },
  { href: '/dashboard/import', key: 'import', icon: '📥' },
  { href: '/dashboard/connections', key: 'connections', icon: '⇄' },
  { href: '/dashboard/settings', key: 'settings', icon: '⚙' },
];

export default function DashboardLayout({ children }) {
  const { token, ready, logout } = useAuth();
  const { lang, setLang } = useLanguage();
  const t = STRINGS[lang] || STRINGS.fa;
  const router = useRouter();
  const pathname = usePathname();
  const [avatarOk, setAvatarOk] = useState(true);
  const [avatarUrl, setAvatarUrl] = useState(null); // user-uploaded profile picture
  const [uploading, setUploading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false); // mobile off-canvas sidebar

  useEffect(() => {
    if (ready && !token) router.replace('/login');
  }, [ready, token, router]);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!token) return;
    apiFetch('/api/profile', { token })
      .then((p) => {
        if (p?.avatar_url) {
          setAvatarUrl(p.avatar_url);
          setAvatarOk(true);
        }
      })
      .catch(() => {});
  }, [token]);

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    setUploading(true);
    try {
      const dataUrl = await fileToAvatarDataUrl(file, 160);
      const p = await apiFetch('/api/profile', { method: 'PATCH', body: { avatar_url: dataUrl }, token });
      setAvatarUrl(p?.avatar_url || dataUrl);
      setAvatarOk(true);
    } catch (err) {
      alert(err.message);
    } finally {
      setUploading(false);
    }
  };

  if (!ready || !token) return null; // avoid flashing dashboard content before the redirect

  return (
    <div className="app-shell">
      <aside className={`sidebar${menuOpen ? ' open' : ''}`}>
        <div className="brandmark">
          <div className="mark mark-handshake">
            <HandshakeMark />
          </div>
          <div className="name">{t.brand}</div>
        </div>

        <div className="navgroup">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMenuOpen(false)}
              className={`navitem${
                (item.href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(item.href))
                  ? ' active'
                  : ''
              }`}
            >
              <span className="ic">{item.icon}</span> {t[item.key]}
            </Link>
          ))}
        </div>

        <div className="sidebar-foot">
          <label className="avatar avatar-photo" title={t.uploadPhoto}>
            {avatarOk ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl || PROFILE_PHOTO_URL} alt="" onError={() => setAvatarOk(false)} />
            ) : (
              'مک'
            )}
            <span className="avatar-cam">{uploading ? '…' : '📷'}</span>
            <input type="file" accept="image/*" onChange={handleAvatarUpload} style={{ display: 'none' }} />
          </label>
          <div className="whorole">
            <div className="who">{t.role}</div>
          </div>
          <button className="theme-toggle" onClick={toggleTheme} title="theme">
            ◐
          </button>
        </div>
        <div className="sidebar-lang">
          <div className="lang-switch">
            <button className={lang === 'fa' ? 'active' : ''} onClick={() => setLang('fa')}>
              فا
            </button>
            <button className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')}>
              EN
            </button>
            <button className={lang === 'ar' ? 'active' : ''} onClick={() => setLang('ar')}>
              ع
            </button>
          </div>
        </div>
        <button className="btn" style={{ marginTop: 10 }} onClick={logout}>
          {t.logout}
        </button>
      </aside>

      {menuOpen && <div className="sidebar-backdrop" onClick={() => setMenuOpen(false)} />}

      <div className="main">
        <header className="mobile-topbar">
          <button className="hamburger" onClick={() => setMenuOpen(true)} aria-label="menu">
            ☰
          </button>
          <div className="mobile-brand">
            <span className="mark mark-handshake mark-sm">
              <HandshakeMark size={15} />
            </span>
            {t.brand}
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}

function toggleTheme() {
  const root = document.documentElement;
  root.setAttribute('data-theme', root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
}
