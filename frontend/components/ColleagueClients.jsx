'use client';

// Colleague clients: requirements a colleague announced in a group. Clicking
// one searches ONLY our own properties to see what we can offer that colleague.
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../lib/AuthContext';
import { useLanguage } from '../lib/LanguageContext';

const STRINGS = {
  fa: {
    desc: 'مشتری‌هایی که همکاران در گروه‌ها اعلام کرده‌اند. با کلیک، از بین «ملک‌های خودم» آفر پیدا کنید.',
    empty: 'مشتری همکاری ثبت نشده.',
    findMine: 'یافتن آفر از ملک‌های من',
    matchesTitle: 'آفرهای من برای این مشتری',
    noMatch: 'ملکِ مناسبی در فهرست شما پیدا نشد.',
    close: 'بستن', wants: 'درخواست', budget: 'بودجه', beds: 'خواب',
    sale: 'خرید', rent: 'اجاره',
  },
  en: {
    desc: 'Clients colleagues announced in groups. Click to find offers from YOUR properties.',
    empty: 'No colleague clients yet.',
    findMine: 'Find offers from my properties',
    matchesTitle: 'My offers for this client',
    noMatch: 'No matching property in your list.',
    close: 'Close', wants: 'Wants', budget: 'Budget', beds: 'bd',
    sale: 'Buy', rent: 'Rent',
  },
  ar: {
    desc: 'عملاء أعلن عنهم الزملاء في المجموعات. انقر للعثور على عروض من عقاراتك.',
    empty: 'لا يوجد عملاء زملاء بعد.',
    findMine: 'ابحث عن عروض من عقاراتي',
    matchesTitle: 'عروضي لهذا العميل',
    noMatch: 'لا يوجد عقار مطابق في قائمتك.',
    close: 'إغلاق', wants: 'يطلب', budget: 'الميزانية', beds: 'غرف',
    sale: 'شراء', rent: 'إيجار',
  },
};

export default function ColleagueClients() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const t = STRINGS[lang] || STRINGS.fa;

  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null); // { client, matches }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setClients(await apiFetch('/api/a2a/clients', { token }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) load();
  }, [token, load]);

  const findMatches = async (client) => {
    setError('');
    try {
      const res = await apiFetch(`/api/a2a/clients/${client.id}/matches`, { token });
      setModal({ client, matches: res.matches || [] });
    } catch (err) {
      setError(err.message);
    }
  };

  const reqLabel = (r) => (r === 'rent' || r === 'mortgage' ? t.rent : t.sale);

  return (
    <div>
      <div className="desc" style={{ marginBottom: 12 }}>{t.desc}</div>
      {error && <div className="form-error">{error}</div>}
      {!loading && clients.length === 0 && <div className="empty-note">{t.empty}</div>}

      <div className="card-list">
        {clients.map((c) => (
          <div className="cust-card" key={c.id}>
            <div className="who">
              <div className="name">{c.sender_name || c.phone || '—'}</div>
              <div className="meta">
                <span className="pill muted">{reqLabel(c.request_type)}</span>
                {c.region && <span>{c.region}</span>}
                {c.bedrooms != null && <span>{c.bedrooms} {t.beds}</span>}
                {c.listed_price != null && <span className="tabular">{t.budget}: {Number(c.listed_price).toLocaleString()}</span>}
              </div>
            </div>
            <div className="card-actions">
              <button className="btn accent" onClick={() => findMatches(c)}>{t.findMine}</button>
            </div>
          </div>
        ))}
      </div>

      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{t.matchesTitle}</h2>
            {modal.matches.length === 0 && <div className="empty-note">{t.noMatch}</div>}
            <div className="card-list">
              {modal.matches.map((p) => (
                <div className="cust-card" key={p.id}>
                  <div className="who">
                    <div className="name">{p.title}</div>
                    <div className="meta">
                      {p.location && <span>{p.location}</span>}
                      {p.price != null && <span className="tabular">{Number(p.price).toLocaleString()}</span>}
                      {p.drive_folder_link && <a href={p.drive_folder_link} target="_blank" rel="noreferrer">📁</a>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setModal(null)}>{t.close}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
