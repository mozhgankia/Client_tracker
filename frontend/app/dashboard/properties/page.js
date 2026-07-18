'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { useAuth } from '../../../lib/AuthContext';
import { useLanguage } from '../../../lib/LanguageContext';

const STRINGS = {
  fa: {
    title: 'ملک‌ها',
    count: (n) => `${n} ملک ثبت‌شده`,
    newProperty: '+ ملک جدید',
    filterAll: 'همه',
    filterPrimary: 'پرایمری',
    filterSecPresale: 'سکندری - پیش‌فروش',
    filterSecReady: 'سکندری - آماده',
    filterSecRent: 'سکندری - اجاره',
    empty: 'هنوز ملکی ثبت نشده.',
    edit: 'ویرایش',
    delete: 'حذف',
    confirmDelete: 'این ملک حذف بشه؟',
    modalNewTitle: 'ملک جدید',
    modalEditTitle: 'ویرایش ملک',
    category: 'دسته',
    subCategory: 'زیردسته (سکندری)',
    deliveryStatus: 'وضعیت تحویل (پرایمری)',
    propTitle: 'عنوان',
    location: 'موقعیت',
    area: 'متراژ (فوت‌مربع)',
    price: 'قیمت',
    description: 'توضیحات',
    ownerPhone: 'شماره تماس مالک',
    ownerContactPlatform: 'پلتفرم ارتباطی مالک',
    driveLink: 'لینک گوگل‌درایو',
    developerName: 'نام سازنده (پرایمری)',
    priority: 'اولویت',
    save: 'ذخیره',
    cancel: 'انصراف',
    saving: 'در حال ذخیره...',
    primary: 'پرایمری',
    secondary: 'سکندری',
    presale: 'پیش‌فروش',
    ready: 'آماده',
    rent: 'اجاره',
    whatsapp: 'واتساپ',
    telegram: 'تلگرام',
  },
  en: {
    title: 'Properties',
    count: (n) => `${n} listed properties`,
    newProperty: '+ New property',
    filterAll: 'All',
    filterPrimary: 'Primary',
    filterSecPresale: 'Secondary - Off-plan',
    filterSecReady: 'Secondary - Ready',
    filterSecRent: 'Secondary - Rent',
    empty: 'No properties yet.',
    edit: 'Edit',
    delete: 'Delete',
    confirmDelete: 'Delete this property?',
    modalNewTitle: 'New property',
    modalEditTitle: 'Edit property',
    category: 'Category',
    subCategory: 'Sub-category (secondary)',
    deliveryStatus: 'Delivery status (primary)',
    propTitle: 'Title',
    location: 'Location',
    area: 'Area (sq ft)',
    price: 'Price',
    description: 'Description',
    ownerPhone: "Owner's phone",
    ownerContactPlatform: "Owner's contact platform",
    driveLink: 'Google Drive link',
    developerName: 'Developer name (primary)',
    priority: 'Priority',
    save: 'Save',
    cancel: 'Cancel',
    saving: 'Saving...',
    primary: 'Primary',
    secondary: 'Secondary',
    presale: 'Off-plan',
    ready: 'Ready',
    rent: 'Rent',
    whatsapp: 'WhatsApp',
    telegram: 'Telegram',
  },
  ar: {
    title: 'العقارات',
    count: (n) => `${n} عقارًا مسجلاً`,
    newProperty: '+ عقار جديد',
    filterAll: 'الكل',
    filterPrimary: 'أولي',
    filterSecPresale: 'ثانوي - قبل الإنجاز',
    filterSecReady: 'ثانوي - جاهز',
    filterSecRent: 'ثانوي - إيجار',
    empty: 'لا توجد عقارات بعد.',
    edit: 'تعديل',
    delete: 'حذف',
    confirmDelete: 'هل تريد حذف هذا العقار؟',
    modalNewTitle: 'عقار جديد',
    modalEditTitle: 'تعديل العقار',
    category: 'الفئة',
    subCategory: 'الفئة الفرعية (ثانوي)',
    deliveryStatus: 'حالة التسليم (أولي)',
    propTitle: 'العنوان',
    location: 'الموقع',
    area: 'المساحة (قدم مربع)',
    price: 'السعر',
    description: 'الوصف',
    ownerPhone: 'رقم هاتف المالك',
    ownerContactPlatform: 'منصة تواصل المالك',
    driveLink: 'رابط جوجل درايف',
    developerName: 'اسم المطوّر (أولي)',
    priority: 'الأولوية',
    save: 'حفظ',
    cancel: 'إلغاء',
    saving: 'جارٍ الحفظ...',
    primary: 'أولي',
    secondary: 'ثانوي',
    presale: 'قبل الإنجاز',
    ready: 'جاهز',
    rent: 'إيجار',
    whatsapp: 'واتساب',
    telegram: 'تيليجرام',
  },
};

const EMPTY_FORM = {
  category: 'secondary',
  sub_category: 'presale',
  delivery_status: '',
  title: '',
  location: '',
  area_sqft: '',
  price: '',
  description: '',
  owner_phone: '',
  owner_contact_platform: 'whatsapp',
  drive_folder_link: '',
  developer_name: '',
  priority: '',
};

const FILTERS = {
  all: {},
  primary: { category: 'primary' },
  secPresale: { category: 'secondary', sub_category: 'presale' },
  secReady: { category: 'secondary', sub_category: 'ready' },
  secRent: { category: 'secondary', sub_category: 'rent' },
};

export default function PropertiesPage() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const t = STRINGS[lang] || STRINGS.fa;

  const [properties, setProperties] = useState([]);
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
      const params = new URLSearchParams(FILTERS[filter]).toString();
      const data = await apiFetch(`/api/properties${params ? `?${params}` : ''}`, { token });
      setProperties(data);
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

  const openEdit = (property) => {
    setEditingId(property.id);
    setForm({
      category: property.category || 'secondary',
      sub_category: property.sub_category || 'presale',
      delivery_status: property.delivery_status || '',
      title: property.title || '',
      location: property.location || '',
      area_sqft: property.area_sqft ?? '',
      price: property.price ?? '',
      description: property.description || '',
      owner_phone: property.owner_phone || '',
      owner_contact_platform: property.owner_contact_platform || 'whatsapp',
      drive_folder_link: property.drive_folder_link || '',
      developer_name: property.developer_name || '',
      priority: property.priority ?? '',
    });
    setModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const body = {
        ...form,
        area_sqft: form.area_sqft === '' ? null : Number(form.area_sqft),
        price: form.price === '' ? null : Number(form.price),
        priority: form.priority === '' ? null : Number(form.priority),
      };
      if (editingId) await apiFetch(`/api/properties/${editingId}`, { method: 'PATCH', body, token });
      else await apiFetch('/api/properties', { method: 'POST', body, token });
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
      await apiFetch(`/api/properties/${id}`, { method: 'DELETE', token });
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
          <div className="desc tabular">{t.count(properties.length)}</div>
        </div>
        <div className="actions">
          <button className="btn accent" onClick={openNew}>
            {t.newProperty}
          </button>
        </div>
      </div>

      <div className="content">
        {error && <div className="form-error">{error}</div>}

        <div className="filters">
          {Object.keys(FILTERS).map((key) => (
            <div key={key} className={`chip${filter === key ? ' active' : ''}`} onClick={() => setFilter(key)}>
              {key === 'all' && t.filterAll}
              {key === 'primary' && t.filterPrimary}
              {key === 'secPresale' && t.filterSecPresale}
              {key === 'secReady' && t.filterSecReady}
              {key === 'secRent' && t.filterSecRent}
            </div>
          ))}
        </div>

        {!loading && properties.length === 0 && <div className="empty-note">{t.empty}</div>}

        <div className="grid-cards">
          {properties.map((p) => (
            <div className="prop-card" key={p.id}>
              <div className="thumb">
                <span className="badge">
                  {t[p.category] || p.category}
                  {p.sub_category ? ` · ${t[p.sub_category] || p.sub_category}` : ''}
                </span>
              </div>
              <div className="body">
                <div className="title">{p.title}</div>
                {p.location && <div className="loc">{p.location}</div>}
                {p.price != null && <div className="price tabular">{p.price.toLocaleString()}</div>}
                <div className="foot">
                  <span className="tag">{p.owner_phone || p.developer_name || ''}</span>
                  <div className="card-actions">
                    <button className="icon-btn" onClick={() => openEdit(p)} title={t.edit}>
                      ✎
                    </button>
                    <button className="icon-btn" onClick={() => handleDelete(p.id)} title={t.delete}>
                      ✕
                    </button>
                  </div>
                </div>
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
                <label>{t.category}</label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  <option value="primary">{t.primary}</option>
                  <option value="secondary">{t.secondary}</option>
                </select>
              </div>
              {form.category === 'secondary' && (
                <div className="field">
                  <label>{t.subCategory}</label>
                  <select
                    value={form.sub_category}
                    onChange={(e) => setForm({ ...form, sub_category: e.target.value })}
                  >
                    <option value="presale">{t.presale}</option>
                    <option value="ready">{t.ready}</option>
                    <option value="rent">{t.rent}</option>
                  </select>
                </div>
              )}
              {form.category === 'primary' && (
                <div className="field">
                  <label>{t.deliveryStatus}</label>
                  <select
                    value={form.delivery_status}
                    onChange={(e) => setForm({ ...form, delivery_status: e.target.value })}
                  >
                    <option value="presale">{t.presale}</option>
                    <option value="ready">{t.ready}</option>
                  </select>
                </div>
              )}
              <div className="field">
                <label>{t.propTitle}</label>
                <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="field">
                <label>{t.location}</label>
                <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
              </div>
              <div className="field">
                <label>{t.area}</label>
                <input
                  type="number"
                  value={form.area_sqft}
                  onChange={(e) => setForm({ ...form, area_sqft: e.target.value })}
                />
              </div>
              <div className="field">
                <label>{t.price}</label>
                <input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
              </div>
              <div className="field">
                <label>{t.description}</label>
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
              {form.category === 'secondary' && (
                <>
                  <div className="field">
                    <label>{t.ownerPhone}</label>
                    <input
                      value={form.owner_phone}
                      onChange={(e) => setForm({ ...form, owner_phone: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label>{t.ownerContactPlatform}</label>
                    <select
                      value={form.owner_contact_platform}
                      onChange={(e) => setForm({ ...form, owner_contact_platform: e.target.value })}
                    >
                      <option value="whatsapp">{t.whatsapp}</option>
                      <option value="telegram">{t.telegram}</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>{t.driveLink}</label>
                    <input
                      value={form.drive_folder_link}
                      onChange={(e) => setForm({ ...form, drive_folder_link: e.target.value })}
                    />
                  </div>
                </>
              )}
              {form.category === 'primary' && (
                <>
                  <div className="field">
                    <label>{t.developerName}</label>
                    <input
                      value={form.developer_name}
                      onChange={(e) => setForm({ ...form, developer_name: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label>{t.priority}</label>
                    <input
                      type="number"
                      value={form.priority}
                      onChange={(e) => setForm({ ...form, priority: e.target.value })}
                    />
                  </div>
                </>
              )}
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
