'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { useAuth } from '../../lib/AuthContext';
import { useLanguage } from '../../lib/LanguageContext';
import DubaiBackdrop from '../../components/DubaiBackdrop';

const STRINGS = {
  fa: {
    hi: 'پیگیری‌های امروز',
    subtitle: 'رسالتِ اصلی: هیچ مشتری‌ای از قلم نیفتد.',
    locale: 'fa-IR',
    due: 'نیازمند پیگیری',
    highDue: 'اولویت‌دار',
    total: 'کل مشتری‌ها',
    empty: '🎉 عالی! امروز همه‌ی پیگیری‌ها انجام شده.',
    markDone: 'پیگیری شد',
    never: 'تا حالا پیگیری نشده',
    daysAgo: (n) => `${n} روز پیش`,
    today: 'امروز',
    potential: { high: 'پتانسیل بالا', medium: 'پتانسیل متوسط', low: 'پتانسیل پایین' },
    overdue: (n) => `${n} روز از موعد گذشته`,
    viewAll: 'همه‌ی مشتری‌ها ←',
  },
  en: {
    hi: "Today's follow-ups",
    subtitle: 'The core mission: never let a client slip through.',
    locale: 'en-GB',
    due: 'Need follow-up',
    highDue: 'High priority',
    total: 'Total clients',
    empty: '🎉 All caught up! No follow-ups left today.',
    markDone: 'Followed up',
    never: 'Never contacted',
    daysAgo: (n) => `${n}d ago`,
    today: 'today',
    potential: { high: 'High potential', medium: 'Medium potential', low: 'Low potential' },
    overdue: (n) => `${n}d overdue`,
    viewAll: 'All clients →',
  },
  ar: {
    hi: 'متابعات اليوم',
    subtitle: 'المهمة الأساسية: ألا يفوتك أي عميل.',
    locale: 'ar-AE',
    due: 'بحاجة لمتابعة',
    highDue: 'أولوية عالية',
    total: 'إجمالي العملاء',
    empty: '🎉 ممتاز! لا متابعات متبقية اليوم.',
    markDone: 'تمت المتابعة',
    never: 'لم تتم متابعته',
    daysAgo: (n) => `قبل ${n} يوم`,
    today: 'اليوم',
    potential: { high: 'إمكانية عالية', medium: 'إمكانية متوسطة', low: 'إمكانية منخفضة' },
    overdue: (n) => `متأخر ${n} يوم`,
    viewAll: 'كل العملاء ←',
  },
};

const THRESHOLD = { high: 2, medium: 5, low: 10 };
const POTENTIAL_RANK = { high: 3, medium: 2, low: 1 };
const todayStr = () => new Date().toISOString().slice(0, 10);

function daysSince(dateStr) {
  if (!dateStr) return Infinity; // never contacted → most urgent
  const then = new Date(dateStr);
  if (Number.isNaN(then.getTime())) return Infinity;
  return Math.floor((Date.now() - then.getTime()) / 86400000);
}

export default function TodayFollowUpsPage() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const t = STRINGS[lang] || STRINGS.fa;

  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCustomers(await apiFetch('/api/customers', { token }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) load();
  }, [token, load]);

  const due = useMemo(() => {
    return customers
      .map((c) => {
        const threshold = THRESHOLD[c.potential] ?? 7;
        const since = daysSince(c.last_follow_up_at);
        return { ...c, _since: since, _overdue: since - threshold };
      })
      .filter((c) => c._overdue >= 0)
      .sort((a, b) => {
        if (b._overdue !== a._overdue) return b._overdue - a._overdue;
        return (POTENTIAL_RANK[b.potential] || 0) - (POTENTIAL_RANK[a.potential] || 0);
      });
  }, [customers]);

  const highDue = due.filter((c) => c.potential === 'high').length;
  const dateLabel = new Date().toLocaleDateString(t.locale, { weekday: 'long', day: 'numeric', month: 'long' });

  const markDone = async (id) => {
    try {
      await apiFetch(`/api/customers/${id}`, { method: 'PATCH', body: { last_follow_up_at: todayStr() }, token });
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const sinceLabel = (c) => {
    if (c._since === Infinity) return t.never;
    if (c._since === 0) return t.today;
    return t.daysAgo(c._since);
  };

  return (
    <>
      <div className="today-hero">
        <DubaiBackdrop variant="today" />
        <div className="today-hero-body">
          <div className="today-date">{dateLabel}</div>
          <h1>{t.hi}</h1>
          <p>{t.subtitle}</p>
          <div className="today-stats">
            <div className="today-stat">
              <b className="tabular">{due.length}</b>
              <span>{t.due}</span>
            </div>
            <div className="today-stat">
              <b className="tabular">{highDue}</b>
              <span>{t.highDue}</span>
            </div>
            <div className="today-stat">
              <b className="tabular">{customers.length}</b>
              <span>{t.total}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="content">
        {error && <div className="form-error">{error}</div>}
        {!loading && due.length === 0 && <div className="empty-note" style={{ borderStyle: 'solid' }}>{t.empty}</div>}

        <div className="card-list">
          {due.map((c) => (
            <div className="cust-card" key={c.id}>
              <div className="who">
                <div className="name">{c.name}</div>
                <div className="meta">
                  <span className="tabular">{c.phone}</span>
                  {c.potential && (
                    <span className={`pill ${c.potential === 'high' ? 'high' : c.potential === 'medium' ? 'medium' : 'low'}`}>
                      {t.potential[c.potential] || c.potential}
                    </span>
                  )}
                  <span>{sinceLabel(c)}</span>
                  {c._overdue > 0 && c._since !== Infinity && <span className="pill muted">{t.overdue(c._overdue)}</span>}
                </div>
              </div>
              <div className="card-actions">
                <button className="btn accent" onClick={() => markDone(c.id)}>
                  ✓ {t.markDone}
                </button>
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 18 }}>
          <a className="btn" href="/dashboard/customers">
            {t.viewAll}
          </a>
        </div>
      </div>
    </>
  );
}
