'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { useAuth } from '../../../lib/AuthContext';
import { useLanguage } from '../../../lib/LanguageContext';

const STRINGS = {
  fa: {
    title: '⚙️ تنظیمات دسته‌بندی',
    desc: 'کلمات کلیدی که مشخص می‌کنند یک مخاطب «مالک» است یا «مشتری». هر کلمه را در یک خط بنویسید. این‌ها روی تشخیصِ خودکارِ چت‌ها اثر می‌گذارند.',
    ownerLabel: 'کلمات کلیدیِ مالک (فروشنده/اجاره‌دهنده)',
    clientLabel: 'کلمات کلیدیِ مشتری (خریدار/متقاضی)',
    hint: 'یک کلمه یا عبارت در هر خط',
    save: 'ذخیره',
    saving: 'در حال ذخیره…',
    saved: 'ذخیره شد ✅',
    reset: 'بازگردانی به پیش‌فرض',
  },
  en: {
    title: '⚙️ Classification settings',
    desc: 'Keywords that decide whether a contact is an “owner” or a “client”. One keyword per line. These drive the automatic chat classification.',
    ownerLabel: 'Owner keywords (seller / landlord)',
    clientLabel: 'Client keywords (buyer / seeker)',
    hint: 'One word or phrase per line',
    save: 'Save',
    saving: 'Saving…',
    saved: 'Saved ✅',
    reset: 'Reset to defaults',
  },
  ar: {
    title: '⚙️ إعدادات التصنيف',
    desc: 'الكلمات المفتاحية التي تحدد ما إذا كان جهة الاتصال «مالكًا» أو «عميلًا». كلمة واحدة في كل سطر. تؤثر على التصنيف التلقائي للمحادثات.',
    ownerLabel: 'كلمات المالك (بائع / مؤجر)',
    clientLabel: 'كلمات العميل (مشترٍ / باحث)',
    hint: 'كلمة أو عبارة واحدة في كل سطر',
    save: 'حفظ',
    saving: 'جارٍ الحفظ…',
    saved: 'تم الحفظ ✅',
    reset: 'إعادة الضبط الافتراضي',
  },
};

const toText = (arr) => (arr || []).join('\n');
const toList = (text) =>
  text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

export default function SettingsPage() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const t = STRINGS[lang] || STRINGS.fa;

  const [ownerText, setOwnerText] = useState('');
  const [clientText, setClientText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await apiFetch('/api/settings', { token });
      setOwnerText(toText(s.owner_keywords));
      setClientText(toText(s.client_keywords));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) load();
  }, [token, load]);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      const s = await apiFetch('/api/settings', {
        method: 'PUT',
        body: { owner_keywords: toList(ownerText), client_keywords: toList(clientText) },
        token,
      });
      setOwnerText(toText(s.owner_keywords));
      setClientText(toText(s.client_keywords));
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="topbar">
        <div>
          <h1>{t.title}</h1>
          <div className="desc">{t.desc}</div>
        </div>
      </div>

      <div className="content">
        {error && <div className="form-error">{error}</div>}
        {saved && <div className="empty-note" style={{ borderStyle: 'solid' }}>{t.saved}</div>}

        {!loading && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 16 }}>
            <div className="card" style={{ padding: 18 }}>
              <label style={{ fontWeight: 700, fontSize: 14 }}>{t.ownerLabel}</label>
              <div className="desc" style={{ margin: '4px 0 10px' }}>{t.hint}</div>
              <textarea
                value={ownerText}
                onChange={(e) => setOwnerText(e.target.value)}
                rows={12}
                style={{ width: '100%', resize: 'vertical' }}
              />
            </div>
            <div className="card" style={{ padding: 18 }}>
              <label style={{ fontWeight: 700, fontSize: 14 }}>{t.clientLabel}</label>
              <div className="desc" style={{ margin: '4px 0 10px' }}>{t.hint}</div>
              <textarea
                value={clientText}
                onChange={(e) => setClientText(e.target.value)}
                rows={12}
                style={{ width: '100%', resize: 'vertical' }}
              />
            </div>
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <button className="btn-primary" style={{ width: 'auto', padding: '10px 28px' }} onClick={save} disabled={saving || loading}>
            {saving ? t.saving : t.save}
          </button>
        </div>
      </div>
    </>
  );
}
