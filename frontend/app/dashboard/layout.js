'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../lib/AuthContext';
import { useLanguage } from '../../lib/LanguageContext';
import BurjKhalifa from '../../components/BurjKhalifa';

const STRINGS = {
  fa: {
    brand: 'Estatemate',
    customers: 'مشتری‌ها',
    properties: 'ملک‌ها',
    leads: 'لیدهای تازه',
    import: 'ورود چت‌ها',
    connections: 'اتصالات',
    role: 'مشاور املاک',
    logout: 'خروج',
  },
  en: {
    brand: 'Estatemate',
    customers: 'Clients',
    properties: 'Properties',
    leads: 'New leads',
    import: 'Import chats',
    connections: 'Connections',
    role: 'Real estate agent',
    logout: 'Log out',
  },
  ar: {
    brand: 'Estatemate',
    customers: 'العملاء',
    properties: 'العقارات',
    leads: 'عملاء محتملون جدد',
    import: 'استيراد المحادثات',
    connections: 'الاتصالات',
    role: 'وسيط عقاري',
    logout: 'تسجيل الخروج',
  },
};

const NAV_ITEMS = [
  { href: '/dashboard/customers', key: 'customers', icon: '◇' },
  { href: '/dashboard/properties', key: 'properties', icon: '▲' },
  { href: '/dashboard/leads', key: 'leads', icon: '◆' },
  { href: '/dashboard/import', key: 'import', icon: '📥' },
  { href: '/dashboard/connections', key: 'connections', icon: '⇄' },
];

export default function DashboardLayout({ children }) {
  const { token, ready, logout } = useAuth();
  const { lang, setLang } = useLanguage();
  const t = STRINGS[lang] || STRINGS.fa;
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (ready && !token) router.replace('/login');
  }, [ready, token, router]);

  if (!ready || !token) return null; // avoid flashing dashboard content before the redirect

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brandmark">
          <div className="mark">E</div>
          <div className="name">{t.brand}</div>
        </div>

        <div className="navgroup">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`navitem${pathname.startsWith(item.href) ? ' active' : ''}`}
            >
              <span className="ic">{item.icon}</span> {t[item.key]}
            </Link>
          ))}
        </div>

        <div className="sidebar-deco">
          <BurjKhalifa />
        </div>

        <div className="sidebar-foot">
          <div className="avatar">مک</div>
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
      <div className="main">{children}</div>
    </div>
  );
}

function toggleTheme() {
  const root = document.documentElement;
  root.setAttribute('data-theme', root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
}
