'use client';

// Agent-to-Agent (colleague) property listings, auto-extracted from colleague
// groups, with Property-Finder-style advanced filters: type, price, area,
// region and bedrooms.
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../lib/AuthContext';
import { useLanguage } from '../lib/LanguageContext';

const STRINGS = {
  fa: {
    desc: 'ملک‌هایی که به‌صورت خودکار از پیام‌های همکاران در گروه‌ها استخراج شده‌اند.',
    type: 'نوع', all: 'همه', sale: 'فروش', rent: 'اجاره',
    region: 'منطقه', minPrice: 'حداقل قیمت', maxPrice: 'حداکثر قیمت',
    minArea: 'حداقل متراژ', maxArea: 'حداکثر متراژ', beds: 'خواب',
    apply: 'اعمال فیلتر', reset: 'پاک کردن', empty: 'ملکی مطابق فیلتر پیدا نشد.',
    count: (n) => `${n} ملکِ همکار`, contact: 'تماس', bedrooms: 'خواب', sqft: 'فوت',
  },
  en: {
    desc: 'Properties auto-extracted from colleagues’ group messages.',
    type: 'Type', all: 'All', sale: 'Sale', rent: 'Rent',
    region: 'Region', minPrice: 'Min price', maxPrice: 'Max price',
    minArea: 'Min area', maxArea: 'Max area', beds: 'Beds',
    apply: 'Apply', reset: 'Reset', empty: 'No listings match these filters.',
    count: (n) => `${n} colleague listings`, contact: 'Contact', bedrooms: 'bd', sqft: 'sqft',
  },
  ar: {
    desc: 'عقارات مستخرجة تلقائيًا من رسائل الزملاء في المجموعات.',
    type: 'النوع', all: 'الكل', sale: 'بيع', rent: 'إيجار',
    region: 'المنطقة', minPrice: 'أدنى سعر', maxPrice: 'أعلى سعر',
    minArea: 'أدنى مساحة', maxArea: 'أعلى مساحة', beds: 'غرف',
    apply: 'تطبيق', reset: 'مسح', empty: 'لا توجد عقارات مطابقة.',
    count: (n) => `${n} عقار زميل`, contact: 'اتصال', bedrooms: 'غرفة', sqft: 'قدم',
  },
};

const EMPTY = { request_type: '', region: '', min_price: '', max_price: '', min_area: '', max_area: '', bedrooms: '' };

export default function A2AProperties() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const t = STRINGS[lang] || STRINGS.fa;

  const [filters, setFilters] = useState(EMPTY);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => v !== '' && params.append(k, v));
      const q = params.toString();
      setItems(await apiFetch(`/api/a2a/properties${q ? `?${q}` : ''}`, { token }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token, filters]);

  useEffect(() => {
    if (token) load();
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k, v) => setFilters((f) => ({ ...f, [k]: v }));

  return (
    <div>
      <div className="desc" style={{ marginBottom: 12 }}>{t.desc}</div>
      {error && <div className="form-error">{error}</div>}

      <div className="a2a-filters">
        <div className="a2a-filter">
          <label>{t.type}</label>
          <select value={filters.request_type} onChange={(e) => set('request_type', e.target.value)}>
            <option value="">{t.all}</option>
            <option value="sale">{t.sale}</option>
            <option value="rent">{t.rent}</option>
          </select>
        </div>
        <div className="a2a-filter">
          <label>{t.region}</label>
          <input value={filters.region} onChange={(e) => set('region', e.target.value)} />
        </div>
        <div className="a2a-filter">
          <label>{t.minPrice}</label>
          <input type="number" value={filters.min_price} onChange={(e) => set('min_price', e.target.value)} />
        </div>
        <div className="a2a-filter">
          <label>{t.maxPrice}</label>
          <input type="number" value={filters.max_price} onChange={(e) => set('max_price', e.target.value)} />
        </div>
        <div className="a2a-filter">
          <label>{t.minArea}</label>
          <input type="number" value={filters.min_area} onChange={(e) => set('min_area', e.target.value)} />
        </div>
        <div className="a2a-filter">
          <label>{t.maxArea}</label>
          <input type="number" value={filters.max_area} onChange={(e) => set('max_area', e.target.value)} />
        </div>
        <div className="a2a-filter">
          <label>{t.beds}</label>
          <input type="number" value={filters.bedrooms} onChange={(e) => set('bedrooms', e.target.value)} />
        </div>
        <div className="a2a-filter-actions">
          <button className="btn accent" onClick={load}>{t.apply}</button>
          <button className="btn" onClick={() => { setFilters(EMPTY); }}>{t.reset}</button>
        </div>
      </div>

      <div className="desc tabular" style={{ margin: '10px 0' }}>{t.count(items.length)}</div>
      {!loading && items.length === 0 && <div className="empty-note">{t.empty}</div>}

      <div className="grid-cards">
        {items.map((p) => (
          <div className="prop-card" key={p.id}>
            <div className="thumb">
              <span className="badge">
                {p.request_type === 'rent' ? t.rent : t.sale}
              </span>
            </div>
            <div className="body">
              <div className="title">{p.region || '—'}</div>
              <div className="meta" style={{ fontSize: 12.5, color: 'var(--ink-soft)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {p.bedrooms != null && <span>{p.bedrooms} {t.bedrooms}</span>}
                {p.area_sqft != null && <span className="tabular">{p.area_sqft} {t.sqft}</span>}
              </div>
              {p.listed_price != null && <div className="price tabular">{Number(p.listed_price).toLocaleString()}</div>}
              {p.raw_message && <div className="loc" style={{ marginTop: 4 }}>«{p.raw_message.slice(0, 90)}»</div>}
              <div className="foot">
                <span className="tag tabular">{p.phone || p.sender_name || ''}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
