'use client';

// For a personal client: search for matching offers from EITHER "my properties"
// or "colleague (A2A) properties". The agent sets/adjusts the criteria, then
// picks the source with one of the two buttons.
import { useState } from 'react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../lib/AuthContext';
import { useLanguage } from '../lib/LanguageContext';

const STRINGS = {
  fa: {
    title: (n) => `یافتن آفر برای ${n}`,
    type: 'نوع', all: 'همه', sale: 'فروش', rent: 'اجاره',
    region: 'منطقه', maxPrice: 'حداکثر بودجه',
    fromMine: 'از ملک‌های من', fromA2A: 'از ملک‌های همکار (A2A)',
    searching: 'در حال جستجو…', results: (n) => `${n} نتیجه`, noMatch: 'موردی پیدا نشد.',
    close: 'بستن', mine: 'ملک من', colleague: 'همکار',
  },
  en: {
    title: (n) => `Find offers for ${n}`,
    type: 'Type', all: 'All', sale: 'Sale', rent: 'Rent',
    region: 'Region', maxPrice: 'Max budget',
    fromMine: 'From my properties', fromA2A: 'From colleague (A2A)',
    searching: 'Searching…', results: (n) => `${n} results`, noMatch: 'Nothing found.',
    close: 'Close', mine: 'Mine', colleague: 'Colleague',
  },
  ar: {
    title: (n) => `ابحث عن عروض لـ ${n}`,
    type: 'النوع', all: 'الكل', sale: 'بيع', rent: 'إيجار',
    region: 'المنطقة', maxPrice: 'أقصى ميزانية',
    fromMine: 'من عقاراتي', fromA2A: 'من عقارات الزملاء (A2A)',
    searching: 'جارٍ البحث…', results: (n) => `${n} نتيجة`, noMatch: 'لا شيء.',
    close: 'إغلاق', mine: 'عقاري', colleague: 'زميل',
  },
};

export default function OfferSearchModal({ customer, onClose }) {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const t = STRINGS[lang] || STRINGS.fa;

  const [criteria, setCriteria] = useState({ request_type: '', region: '', max_price: '' });
  const [source, setSource] = useState(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');

  const search = async (src) => {
    setBusy(true);
    setSource(src);
    setError('');
    try {
      const res = await apiFetch('/api/a2a/match', { method: 'POST', body: { ...criteria, source: src }, token });
      setResults(res.matches || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const set = (k, v) => setCriteria((c) => ({ ...c, [k]: v }));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t.title(customer.name)}</h2>
        {error && <div className="form-error">{error}</div>}

        <div className="field">
          <label>{t.type}</label>
          <select value={criteria.request_type} onChange={(e) => set('request_type', e.target.value)}>
            <option value="">{t.all}</option>
            <option value="sale">{t.sale}</option>
            <option value="rent">{t.rent}</option>
          </select>
        </div>
        <div className="field">
          <label>{t.region}</label>
          <input value={criteria.region} onChange={(e) => set('region', e.target.value)} />
        </div>
        <div className="field">
          <label>{t.maxPrice}</label>
          <input type="number" value={criteria.max_price} onChange={(e) => set('max_price', e.target.value)} />
        </div>

        <div className="modal-actions">
          <button className="btn accent" disabled={busy} onClick={() => search('own')}>{t.fromMine}</button>
          <button className="btn-primary" disabled={busy} onClick={() => search('a2a')}>{t.fromA2A}</button>
        </div>

        {busy && <div className="desc" style={{ marginTop: 12 }}>{t.searching}</div>}

        {results && !busy && (
          <div style={{ marginTop: 14 }}>
            <div className="desc tabular" style={{ marginBottom: 8 }}>
              {t.results(results.length)} · {source === 'a2a' ? t.colleague : t.mine}
            </div>
            {results.length === 0 && <div className="empty-note">{t.noMatch}</div>}
            <div className="card-list">
              {results.map((p) => (
                <div className="cust-card" key={p.id}>
                  <div className="who">
                    <div className="name">{p.title || p.region || '—'}</div>
                    <div className="meta">
                      {(p.location || p.region) && <span>{p.location || p.region}</span>}
                      {(p.price ?? p.listed_price) != null && (
                        <span className="tabular">{Number(p.price ?? p.listed_price).toLocaleString()}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="modal-actions" style={{ marginTop: 12 }}>
          <button className="btn" onClick={onClose}>{t.close}</button>
        </div>
      </div>
    </div>
  );
}
