'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { useAuth } from '../../../lib/AuthContext';
import { useLanguage } from '../../../lib/LanguageContext';

const STRINGS = {
  fa: {
    title: '🧠 دسته‌بندی هوشمند',
    desc: 'مخاطب‌ها به‌صورت خودکار به سه دسته تقسیم می‌شوند. برای ناشناس‌ها، هوش مصنوعی دسته را پیشنهاد می‌دهد و شما تأیید یا رد می‌کنید.',
    owners: 'مالکان',
    clients: 'مشتری‌ها',
    unknown: 'ناشناس',
    empty: 'موردی نیست.',
    suggest: 'پیشنهاد هوش مصنوعی',
    suggesting: 'در حال تحلیل…',
    markOwner: 'مالک',
    markClient: 'مشتری',
    accept: 'تأیید',
    reject: 'رد',
    confidence: 'اطمینان',
    settingsLink: 'ویرایش کلمات کلیدی ←',
  },
  en: {
    title: '🧠 Smart classification',
    desc: 'Contacts are auto-sorted into three buckets. For unknowns, the AI suggests a category and you accept or reject it.',
    owners: 'Owners',
    clients: 'Clients',
    unknown: 'Unknown',
    empty: 'Nothing here.',
    suggest: 'AI suggestion',
    suggesting: 'Analyzing…',
    markOwner: 'Owner',
    markClient: 'Client',
    accept: 'Accept',
    reject: 'Reject',
    confidence: 'confidence',
    settingsLink: 'Edit keywords →',
  },
  ar: {
    title: '🧠 التصنيف الذكي',
    desc: 'تُصنَّف جهات الاتصال تلقائيًا إلى ثلاث فئات. للمجهولين، يقترح الذكاء الاصطناعي فئة وأنت تقبلها أو ترفضها.',
    owners: 'المالكون',
    clients: 'العملاء',
    unknown: 'غير معروف',
    empty: 'لا شيء هنا.',
    suggest: 'اقتراح الذكاء الاصطناعي',
    suggesting: 'جارٍ التحليل…',
    markOwner: 'مالك',
    markClient: 'عميل',
    accept: 'قبول',
    reject: 'رفض',
    confidence: 'الثقة',
    settingsLink: 'تعديل الكلمات المفتاحية ←',
  },
};

function contactName(lead) {
  return lead.sender_name || lead.phone || lead.telegram_id || '—';
}

export default function ClassificationPage() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const t = STRINGS[lang] || STRINGS.fa;

  const [data, setData] = useState({ groups: { owners: [], clients: [], unknown: [] }, counts: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [suggestions, setSuggestions] = useState({}); // { [leadId]: {role, confidence, reason} | 'loading' }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await apiFetch('/api/classification', { token }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) load();
  }, [token, load]);

  const setRole = async (id, role) => {
    try {
      await apiFetch(`/api/classification/${id}/role`, { method: 'POST', body: { role }, token });
      setSuggestions((s) => {
        const next = { ...s };
        delete next[id];
        return next;
      });
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const askSuggestion = async (id) => {
    setSuggestions((s) => ({ ...s, [id]: 'loading' }));
    setError('');
    try {
      const suggestion = await apiFetch(`/api/classification/${id}/suggest`, { method: 'POST', body: {}, token });
      setSuggestions((s) => ({ ...s, [id]: suggestion }));
    } catch (err) {
      setError(err.message);
      setSuggestions((s) => {
        const next = { ...s };
        delete next[id];
        return next;
      });
    }
  };

  const roleWord = (role) => (role === 'owner' ? t.markOwner : role === 'client' ? t.markClient : t.unknown);

  const Column = ({ title, items, kind }) => (
    <div className="classify-col">
      <div className="classify-col-head">
        <span className={`pill ${kind === 'owners' ? 'ok' : kind === 'clients' ? 'low' : 'muted'}`}>{title}</span>
        <span className="count">{items.length}</span>
      </div>
      {items.length === 0 && <div className="empty-note">{t.empty}</div>}
      <div className="card-list">
        {items.map((lead) => {
          const sug = suggestions[lead.id];
          return (
            <div className="lead-card" key={lead.id} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <div className="who">
                <div className="name">{contactName(lead)}</div>
                <div className="meta">
                  {lead.region && <span>{lead.region}</span>}
                  {lead.request_type && <span className="pill muted">{lead.request_type}</span>}
                  {lead.raw_message && <span>«{lead.raw_message.slice(0, 70)}»</span>}
                </div>
              </div>

              {kind === 'unknown' && (
                <div style={{ marginTop: 10 }}>
                  {!sug && (
                    <div className="card-actions" style={{ flexWrap: 'wrap' }}>
                      <button className="btn accent" onClick={() => askSuggestion(lead.id)}>
                        {t.suggest}
                      </button>
                      <button className="btn" onClick={() => setRole(lead.id, 'owner')}>
                        {t.markOwner}
                      </button>
                      <button className="btn" onClick={() => setRole(lead.id, 'client')}>
                        {t.markClient}
                      </button>
                    </div>
                  )}
                  {sug === 'loading' && <div className="desc">{t.suggesting}</div>}
                  {sug && sug !== 'loading' && (
                    <div className="suggestion-box">
                      <div>
                        <strong>{roleWord(sug.role)}</strong>{' '}
                        <span className="desc">
                          ({t.confidence}: {Math.round((sug.confidence || 0) * 100)}%)
                        </span>
                      </div>
                      {sug.reason && <div className="desc" style={{ marginTop: 4 }}>{sug.reason}</div>}
                      <div className="card-actions" style={{ marginTop: 10, flexWrap: 'wrap' }}>
                        <button
                          className="btn accent"
                          disabled={sug.role !== 'owner' && sug.role !== 'client'}
                          onClick={() => setRole(lead.id, sug.role)}
                        >
                          {t.accept}
                        </button>
                        <button
                          className="btn"
                          onClick={() =>
                            setSuggestions((s) => {
                              const next = { ...s };
                              delete next[lead.id];
                              return next;
                            })
                          }
                        >
                          {t.reject}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {kind !== 'unknown' && (
                <div className="card-actions" style={{ marginTop: 10 }}>
                  <button className="btn" onClick={() => setRole(lead.id, kind === 'owners' ? 'client' : 'owner')}>
                    → {kind === 'owners' ? t.markClient : t.markOwner}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      <div className="topbar">
        <div>
          <h1>{t.title}</h1>
          <div className="desc">{t.desc}</div>
        </div>
        <div className="actions">
          <a className="btn" href="/dashboard/settings">
            {t.settingsLink}
          </a>
        </div>
      </div>

      <div className="content">
        {error && <div className="form-error">{error}</div>}
        {loading && <div className="desc">…</div>}
        <div className="classify-board">
          <Column title={t.owners} items={data.groups.owners} kind="owners" />
          <Column title={t.clients} items={data.groups.clients} kind="clients" />
          <Column title={t.unknown} items={data.groups.unknown} kind="unknown" />
        </div>
      </div>
    </>
  );
}
