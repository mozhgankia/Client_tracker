'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { useAuth } from '../../../lib/AuthContext';
import { useLanguage } from '../../../lib/LanguageContext';

const STRINGS = {
  fa: {
    title: 'مشتری‌ها',
    count: (n) => `${n} مشتری ثبت‌شده`,
    newCustomer: '+ مشتری جدید',
    filterAll: 'همه',
    filterResidential: 'مسکونی',
    filterCommercial: 'تجاری',
    filterHighPotential: 'پتانسیل بالا',
    empty: 'هنوز مشتری‌ای ثبت نشده.',
    edit: 'ویرایش',
    delete: 'حذف',
    confirmDelete: 'این مشتری حذف بشه؟',
    modalNewTitle: 'مشتری جدید',
    modalEditTitle: 'ویرایش مشتری',
    name: 'نام',
    phone: 'شماره تماس',
    type: 'نوع',
    subtype: 'دسته',
    potential: 'پتانسیل',
    status: 'وضعیت',
    notes: 'یادداشت (علاقه‌مندی/پاسخگویی)',
    firstMessageAt: 'تاریخ اولین پیام',
    lastFollowUpAt: 'تاریخ آخرین پیگیری',
    save: 'ذخیره',
    cancel: 'انصراف',
    saving: 'در حال ذخیره...',
    residential: 'مسکونی',
    commercial: 'تجاری',
    presale: 'پیش‌فروش',
    ready: 'آماده',
    high: 'بالا',
    medium: 'متوسط',
    low: 'پایین',
  },
  en: {
    title: 'Clients',
    count: (n) => `${n} registered clients`,
    newCustomer: '+ New client',
    filterAll: 'All',
    filterResidential: 'Residential',
    filterCommercial: 'Commercial',
    filterHighPotential: 'High potential',
    empty: 'No clients yet.',
    edit: 'Edit',
    delete: 'Delete',
    confirmDelete: 'Delete this client?',
    modalNewTitle: 'New client',
    modalEditTitle: 'Edit client',
    name: 'Name',
    phone: 'Phone',
    type: 'Type',
    subtype: 'Subtype',
    potential: 'Potential',
    status: 'Status',
    notes: 'Notes (interest/responsiveness)',
    firstMessageAt: 'First message date',
    lastFollowUpAt: 'Last follow-up date',
    save: 'Save',
    cancel: 'Cancel',
    saving: 'Saving...',
    residential: 'Residential',
    commercial: 'Commercial',
    presale: 'Off-plan',
    ready: 'Ready',
    high: 'High',
    medium: 'Medium',
    low: 'Low',
  },
  ar: {
    title: 'العملاء',
    count: (n) => `${n} عميلاً مسجلاً`,
    newCustomer: '+ عميل جديد',
    filterAll: 'الكل',
    filterResidential: 'سكني',
    filterCommercial: 'تجاري',
    filterHighPotential: 'اهتمام مرتفع',
    empty: 'لا يوجد عملاء بعد.',
    edit: 'تعديل',
    delete: 'حذف',
    confirmDelete: 'هل تريد حذف هذا العميل؟',
    modalNewTitle: 'عميل جديد',
    modalEditTitle: 'تعديل العميل',
    name: 'الاسم',
    phone: 'رقم الهاتف',
    type: 'النوع',
    subtype: 'الفئة',
    potential: 'الاهتمام',
    status: 'الحالة',
    notes: 'ملاحظات (الاهتمام/الاستجابة)',
    firstMessageAt: 'تاريخ أول رسالة',
    lastFollowUpAt: 'تاريخ آخر متابعة',
    save: 'حفظ',
    cancel: 'إلغاء',
    saving: 'جارٍ الحفظ...',
    residential: 'سكني',
    commercial: 'تجاري',
    presale: 'قبل الإنجاز',
    ready: 'جاهز',
    high: 'مرتفع',
    medium: 'متوسط',
    low: 'منخفض',
  },
};

const EMPTY_FORM = {
  name: '',
  phone: '',
  type: 'residential',
  subtype: 'presale',
  potential: 'medium',
  status: '',
  notes: '',
  first_message_at: '',
  last_follow_up_at: '',
};

export default function CustomersPage() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const t = STRINGS[lang] || STRINGS.fa;

  const [customers, setCustomers] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = {
        residential: '?type=residential',
        commercial: '?type=commercial',
        high: '?potential=high',
      }[filter];
      const data = await apiFetch(`/api/customers${query || ''}`, { token });
      setCustomers(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token, filter]);

  useEffect(() => {
    if (token) load();
  }, [token, load]);

  const openNew = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEdit = (customer) => {
    setEditingId(customer.id);
    setForm({
      name: customer.name || '',
      phone: customer.phone || '',
      type: customer.type || 'residential',
      subtype: customer.subtype || 'presale',
      potential: customer.potential || 'medium',
      status: customer.status || '',
      notes: customer.notes || '',
      first_message_at: customer.first_message_at || '',
      last_follow_up_at: customer.last_follow_up_at || '',
    });
    setModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (editingId) await apiFetch(`/api/customers/${editingId}`, { method: 'PATCH', body: form, token });
      else await apiFetch('/api/customers', { method: 'POST', body: form, token });
      setModalOpen(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm(t.confirmDelete)) return;
    try {
      await apiFetch(`/api/customers/${id}`, { method: 'DELETE', token });
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
          <div className="desc tabular">{t.count(customers.length)}</div>
        </div>
        <div className="actions">
          <button className="btn accent" onClick={openNew}>
            {t.newCustomer}
          </button>
        </div>
      </div>

      <div className="content">
        {error && <div className="form-error">{error}</div>}

        <div className="filters">
          {['all', 'residential', 'commercial', 'high'].map((key) => (
            <div key={key} className={`chip${filter === key ? ' active' : ''}`} onClick={() => setFilter(key)}>
              {key === 'all' && t.filterAll}
              {key === 'residential' && t.filterResidential}
              {key === 'commercial' && t.filterCommercial}
              {key === 'high' && t.filterHighPotential}
            </div>
          ))}
        </div>

        {!loading && customers.length === 0 && <div className="empty-note">{t.empty}</div>}

        <div className="card-list">
          {customers.map((c) => (
            <div className="cust-card" key={c.id}>
              <div className="who">
                <div className="name">{c.name}</div>
                <div className="meta">
                  <span>
                    {t[c.type] || c.type} · {t[c.subtype] || c.subtype}
                  </span>
                  {c.potential && <span className={`pill ${c.potential}`}>{t[c.potential] || c.potential}</span>}
                  {c.last_follow_up_at && (
                    <span className="tabular">
                      {t.lastFollowUpAt}: {c.last_follow_up_at}
                    </span>
                  )}
                </div>
              </div>
              <div className="card-actions">
                <button className="icon-btn" onClick={() => openEdit(c)} title={t.edit}>
                  ✎
                </button>
                <button className="icon-btn" onClick={() => handleDelete(c.id)} title={t.delete}>
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {modalOpen && (
        <div className="modal-backdrop" onClick={() => setModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editingId ? t.modalEditTitle : t.modalNewTitle}</h2>
            <form onSubmit={handleSubmit}>
              <div className="field">
                <label>{t.name}</label>
                <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="field">
                <label>{t.phone}</label>
                <input required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div className="field">
                <label>{t.type}</label>
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  <option value="residential">{t.residential}</option>
                  <option value="commercial">{t.commercial}</option>
                </select>
              </div>
              <div className="field">
                <label>{t.subtype}</label>
                <select value={form.subtype} onChange={(e) => setForm({ ...form, subtype: e.target.value })}>
                  <option value="presale">{t.presale}</option>
                  <option value="ready">{t.ready}</option>
                </select>
              </div>
              <div className="field">
                <label>{t.potential}</label>
                <select value={form.potential} onChange={(e) => setForm({ ...form, potential: e.target.value })}>
                  <option value="high">{t.high}</option>
                  <option value="medium">{t.medium}</option>
                  <option value="low">{t.low}</option>
                </select>
              </div>
              <div className="field">
                <label>{t.status}</label>
                <input value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} />
              </div>
              <div className="field">
                <label>{t.notes}</label>
                <textarea
                  rows={3}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>
              <div className="field">
                <label>{t.firstMessageAt}</label>
                <input
                  type="date"
                  value={form.first_message_at}
                  onChange={(e) => setForm({ ...form, first_message_at: e.target.value })}
                />
              </div>
              <div className="field">
                <label>{t.lastFollowUpAt}</label>
                <input
                  type="date"
                  value={form.last_follow_up_at}
                  onChange={(e) => setForm({ ...form, last_follow_up_at: e.target.value })}
                />
              </div>
              <div className="modal-actions">
                <button className="btn" type="button" onClick={() => setModalOpen(false)}>
                  {t.cancel}
                </button>
                <button className="btn-primary" type="submit" disabled={saving}>
                  {saving ? t.saving : t.save}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
