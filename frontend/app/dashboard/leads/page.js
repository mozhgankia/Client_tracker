'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { useAuth } from '../../../lib/AuthContext';
import { useLanguage } from '../../../lib/LanguageContext';

const STRINGS = {
  fa: {
    title: '🤖 مدیریت چت‌ها',
    desc: 'مخاطب‌هایی که ربات از تحلیل چت‌های واتساپ و تلگرام پیدا کرده — هر کدام در صندوقِ خودش.',
    tabWhatsapp: '💬 واتساپ',
    tabTelegram: '✈️ تلگرام',
    empty: 'در این صندوق فعلاً چیزی نیست.',
    addAsCustomer: 'افزودن به مشتری‌ها',
    addAsProperty: 'افزودن به ملک‌ها',
    dismiss: 'نادیده بگیر',
    roleLabel: 'دسته:',
    roleOwner: 'مالک',
    roleClient: 'مشتری',
    roleUnknown: 'نامشخص',
    auto: 'خودکار',
    propertyModalTitle: 'افزودن به ملک‌ها',
    category: 'دسته',
    subCategory: 'زیردسته (سکندری)',
    primary: 'پرایمری',
    secondary: 'سکندری',
    presale: 'پیش‌فروش',
    ready: 'آماده',
    rent: 'اجاره',
    confirm: 'تأیید',
    cancel: 'انصراف',
  },
  en: {
    title: '🤖 Chat management',
    desc: 'Contacts the bot found from WhatsApp and Telegram chats — each in its own inbox.',
    tabWhatsapp: '💬 WhatsApp',
    tabTelegram: '✈️ Telegram',
    empty: 'Nothing in this inbox yet.',
    addAsCustomer: 'Add to clients',
    addAsProperty: 'Add to properties',
    dismiss: 'Dismiss',
    roleLabel: 'Category:',
    roleOwner: 'Owner',
    roleClient: 'Client',
    roleUnknown: 'Unknown',
    auto: 'auto',
    propertyModalTitle: 'Add to properties',
    category: 'Category',
    subCategory: 'Sub-category (secondary)',
    primary: 'Primary',
    secondary: 'Secondary',
    presale: 'Off-plan',
    ready: 'Ready',
    rent: 'Rent',
    confirm: 'Confirm',
    cancel: 'Cancel',
  },
  ar: {
    title: '🤖 إدارة المحادثات',
    desc: 'جهات اتصال وجدها البوت من محادثات واتساب وتيليجرام — كل منها في صندوقه.',
    tabWhatsapp: '💬 واتساب',
    tabTelegram: '✈️ تيليجرام',
    empty: 'لا شيء في هذا الصندوق بعد.',
    addAsCustomer: 'إضافة إلى العملاء',
    addAsProperty: 'إضافة إلى العقارات',
    dismiss: 'تجاهل',
    roleLabel: 'الفئة:',
    roleOwner: 'مالك',
    roleClient: 'عميل',
    roleUnknown: 'غير معروف',
    auto: 'تلقائي',
    propertyModalTitle: 'إضافة إلى العقارات',
    category: 'الفئة',
    subCategory: 'الفئة الفرعية (ثانوي)',
    primary: 'أولي',
    secondary: 'ثانوي',
    presale: 'قبل الإنجاز',
    ready: 'جاهز',
    rent: 'إيجار',
    confirm: 'تأكيد',
    cancel: 'إلغاء',
  },
};

export default function LeadsPage() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const t = STRINGS[lang] || STRINGS.fa;

  const [source, setSource] = useState('whatsapp'); // 'whatsapp' | 'telegram'
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [propertyModalLeadId, setPropertyModalLeadId] = useState(null);
  const [propertyForm, setPropertyForm] = useState({ category: 'secondary', sub_category: 'presale' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setLeads(await apiFetch(`/api/leads?source=${source}`, { token }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token, source]);

  useEffect(() => {
    if (token) load();
  }, [token, load]);

  const handleDismiss = async (id) => {
    try {
      await apiFetch(`/api/leads/${id}/dismiss`, { method: 'POST', token });
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleAddAsCustomer = async (id) => {
    try {
      await apiFetch(`/api/leads/${id}/convert-to-customer`, { method: 'POST', body: {}, token });
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  // Manual override of the AI's category, so a wrong guess can be corrected.
  const handleSetRole = async (id, role) => {
    try {
      await apiFetch(`/api/classification/${id}/role`, { method: 'POST', body: { role }, token });
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const openPropertyModal = (id) => {
    setPropertyModalLeadId(id);
    setPropertyForm({ category: 'secondary', sub_category: 'presale' });
  };

  const handleConvertToProperty = async (e) => {
    e.preventDefault();
    try {
      await apiFetch(`/api/leads/${propertyModalLeadId}/convert-to-property`, {
        method: 'POST',
        body: propertyForm,
        token,
      });
      setPropertyModalLeadId(null);
      await load();
    } catch (err) {
      setError(err.message);
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
        {/* WhatsApp / Telegram separate inboxes */}
        <div className="seg-tabs">
          <button className={`seg${source === 'whatsapp' ? ' active' : ''}`} onClick={() => setSource('whatsapp')}>
            {t.tabWhatsapp}
          </button>
          <button className={`seg${source === 'telegram' ? ' active' : ''}`} onClick={() => setSource('telegram')}>
            {t.tabTelegram}
          </button>
        </div>

        {error && <div className="form-error">{error}</div>}
        {!loading && leads.length === 0 && <div className="empty-note">{t.empty}</div>}

        <div className="card-list">
          {leads.map((lead) => (
            <div className="lead-card" key={lead.id}>
              <div className="who">
                <div className="name">{lead.sender_name || lead.phone || lead.telegram_id}</div>
                <div className="meta">
                  {lead.region && <span>{lead.region}</span>}
                  {lead.listed_price != null && <span className="tabular">{lead.listed_price.toLocaleString()}</span>}
                  {lead.raw_message && <span>«{lead.raw_message.slice(0, 80)}»</span>}
                </div>
                {/* smart + manual classification */}
                <div className="meta" style={{ marginTop: 6, alignItems: 'center' }}>
                  <span className="pill muted">{t.roleLabel}</span>
                  <select
                    className="role-select"
                    value={lead.role || 'unknown'}
                    onChange={(e) => handleSetRole(lead.id, e.target.value)}
                    title={t.auto}
                  >
                    <option value="owner">{t.roleOwner}</option>
                    <option value="client">{t.roleClient}</option>
                    <option value="unknown">{t.roleUnknown}</option>
                  </select>
                </div>
              </div>
              <div className="card-actions">
                <button className="btn" onClick={() => handleAddAsCustomer(lead.id)}>
                  {t.addAsCustomer}
                </button>
                <button className="btn" onClick={() => openPropertyModal(lead.id)}>
                  {t.addAsProperty}
                </button>
                <div className="icon-btn" onClick={() => handleDismiss(lead.id)} title={t.dismiss}>
                  ✕
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {propertyModalLeadId && (
        <div className="modal-backdrop" onClick={() => setPropertyModalLeadId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{t.propertyModalTitle}</h2>
            <form onSubmit={handleConvertToProperty}>
              <div className="field">
                <label>{t.category}</label>
                <select
                  value={propertyForm.category}
                  onChange={(e) => setPropertyForm({ ...propertyForm, category: e.target.value })}
                >
                  <option value="primary">{t.primary}</option>
                  <option value="secondary">{t.secondary}</option>
                </select>
              </div>
              {propertyForm.category === 'secondary' && (
                <div className="field">
                  <label>{t.subCategory}</label>
                  <select
                    value={propertyForm.sub_category}
                    onChange={(e) => setPropertyForm({ ...propertyForm, sub_category: e.target.value })}
                  >
                    <option value="presale">{t.presale}</option>
                    <option value="ready">{t.ready}</option>
                    <option value="rent">{t.rent}</option>
                  </select>
                </div>
              )}
              <div className="modal-actions">
                <button className="btn" type="button" onClick={() => setPropertyModalLeadId(null)}>
                  {t.cancel}
                </button>
                <button className="btn-primary" type="submit">
                  {t.confirm}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
