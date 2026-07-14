// ------------------------------------------------------------------
// پیگیری مشتریان واتساپ — ذخیره‌سازی کامل در localStorage مرورگر
// ------------------------------------------------------------------

const STORAGE_KEYS = {
  customers: 'wct_customers',
  projects: 'wct_projects',
  secondary: 'wct_secondary',
};

const POTENTIAL_INTERVAL_DAYS = { high: 7, medium: 21, low: 42 };

const LABELS = {
  type: { residential: 'رزیدنشال', commercial: 'کامرشال' },
  subtype: { presale: 'پیش‌فروش', ready: 'آماده' },
  potential: { high: 'زیاد', medium: 'متوسط', low: 'کم' },
  status: {
    following: 'در حال پیگیری',
    viewing: 'ویووینگ اومده',
    purchased: 'خرید کرده',
    multiplePurchases: 'چند خرید داشته',
    purchasedElsewhere: 'با کس دیگه خرید کرده',
  },
  deliveryStatus: { presale: 'پیش‌فروش', ready: 'آماده (مستقیم از سازنده)' },
  secCategory: { presale: 'سکندری - پیش‌فروش', ready: 'سکندری - آماده', rent: 'سکندری - اجاره' },
  secStatus: { active: 'فعال', closed: 'فروخته شد / اجاره داده شد' },
  contactPlatform: { whatsapp: 'واتساپ', telegram: 'تلگرام' },
  interested: { yes: 'پاسخگو', no: 'بی‌پاسخ', unknown: 'نامشخص' },
};

// ---------- helpers ----------
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const todayStr = () => new Date().toISOString().slice(0, 10);
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function daysBetween(fromDateStr, toDateStr) {
  const a = new Date(fromDateStr);
  const b = new Date(toDateStr);
  return Math.floor((b - a) / 86400000);
}

function loadArr(key) {
  try { return JSON.parse(localStorage.getItem(key)) || []; }
  catch { return []; }
}
function saveArr(key, arr) { localStorage.setItem(key, JSON.stringify(arr)); }

// شماره تماس رو نرمال می‌کنه (فقط رقم، ۱۰ رقم آخر) تا با پیشوندهای مختلف (0/98/+98) یکسان مقایسه بشه
function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.slice(-10);
}

function slugify(text) {
  return String(text || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 60);
}

let customers = loadArr(STORAGE_KEYS.customers);
let projects = loadArr(STORAGE_KEYS.projects);
let secondary = loadArr(STORAGE_KEYS.secondary); // ملک‌های سکندری: presale/ready/rent در یک آرایه، با فیلد category
let autoProjects = []; // fetched from data/projects.json (developer news monitor)
let contactInsights = []; // fetched from data/contact-insights.json (WhatsApp main-number bot)
let newLeads = []; // fetched from data/new-leads.json (contacts/properties detected by the WhatsApp bot)
let reportsIndex = []; // fetched from reports/index.json (price analysis reports)
const dismissedLeads = new Set(loadArr('wct_dismissed_leads'));

const persistCustomers = () => saveArr(STORAGE_KEYS.customers, customers);
const persistProjects = () => saveArr(STORAGE_KEYS.projects, projects);
const persistSecondary = () => saveArr(STORAGE_KEYS.secondary, secondary);
const persistDismissedLeads = () => saveArr('wct_dismissed_leads', Array.from(dismissedLeads));

// ---------- زنده از ربات واتساپ متصل به شماره اصلی (data/contact-insights.json) ----------
async function loadContactInsights() {
  try {
    const res = await fetch('data/contact-insights.json', { cache: 'no-store' });
    if (!res.ok) return;
    const raw = await res.json();
    contactInsights = Array.isArray(raw) ? raw : [];
  } catch {
    contactInsights = [];
  }
  renderCustomers();
  renderSecondaryTab('presale');
  renderSecondaryTab('ready');
  renderSecondaryTab('rent');
}

function findInsightForPhone(phone) {
  const norm = normalizePhone(phone);
  if (!norm) return null;
  return contactInsights.find((i) => normalizePhone(i.phone) === norm) || null;
}

// بنر پیشنهاد زنده‌ی ربات واتساپ برای یک شماره؛ اگه applyAction بدید یک دکمه اعمال هم نشون می‌ده
// (برای مشتری‌ها که فیلد پتانسیل/علاقه‌مندی دارن)، وگرنه فقط اطلاعاتیه (برای مالک‌های روی ملک)
function renderInsightBanner(phone, { applyAction, applyId, appliedAt } = {}) {
  const insight = findInsightForPhone(phone);
  if (!insight) return '';
  if (appliedAt && appliedAt === insight.updated_at) return '';
  const applyBtn = applyAction
    ? `<div><button type="button" class="btn btn-primary btn-sm" data-action="${applyAction}" data-id="${escapeHtml(applyId)}">اعمال پیشنهاد</button></div>`
    : '';
  return `
    <div class="followup-suggestion insight-banner">
      🤖 پیام تازه در واتساپ (${insight.last_message_at ? toFa(insight.last_message_at.slice(0, 10)) : 'اخیراً'}):
      ${insight.last_message_preview ? `«${escapeHtml(insight.last_message_preview)}»<br>` : ''}
      ${insight.note ? escapeHtml(insight.note) + '<br>' : ''}
      ${insight.suggested_potential ? `پتانسیل پیشنهادی: <strong>${LABELS.potential[insight.suggested_potential] || '—'}</strong> · ` : ''}
      ${insight.suggested_interested ? `علاقه‌مندی: <strong>${LABELS.interested[insight.suggested_interested] || 'نامشخص'}</strong>` : ''}
      ${applyBtn}
    </div>
  `;
}

// ---------- مخاطب‌ها/ملک‌های تازه‌کشف‌شده توسط ربات واتساپ (data/new-leads.json) ----------
function leadKey(lead) {
  return `${normalizePhone(lead.phone)}::${slugify(lead.property_hint || lead.name)}`;
}

async function loadNewLeads() {
  try {
    const res = await fetch('data/new-leads.json', { cache: 'no-store' });
    if (!res.ok) return;
    const raw = await res.json();
    newLeads = (Array.isArray(raw) ? raw : []).map((l) => ({ ...l, _key: leadKey(l) }));
  } catch {
    newLeads = [];
  }
  renderNewLeads();
}

function renderNewLeads() {
  const container = $('#newLeadsList');

  const visible = newLeads.filter((l) => {
    if (dismissedLeads.has(l._key)) return false;
    if (l.role === 'customer') {
      const phone = normalizePhone(l.phone);
      return !customers.some((c) => normalizePhone(c.phone) === phone);
    }
    if (l.role === 'owner') {
      // فقط اگه دقیقاً همین ملک قبلاً ثبت شده، مخفی کن — چون یک مالک ممکنه چند ملک جدا داشته باشه
      const phone = normalizePhone(l.phone);
      const already = secondary.some((s) =>
        normalizePhone(s.ownerPhone) === phone && s.name && slugify(s.name) === slugify(l.property_hint || l.name)
      );
      return !already;
    }
    return false;
  });

  if (visible.length === 0) {
    container.innerHTML = '';
    container.classList.add('hidden');
    return;
  }
  container.classList.remove('hidden');
  container.innerHTML = `<div class="panel-head"><h2>🤖 مخاطب‌ها/ملک‌های تازه (از واتساپ)</h2></div>` +
    visible.map((l) => `
      <div class="card">
        <div class="card-top">
          <div>
            <div class="card-name">${escapeHtml(l.name || l.phone)} <span class="card-sub">(${escapeHtml(l.phone)})</span></div>
            <div class="card-sub">${l.property_hint ? escapeHtml(l.property_hint) : ''}</div>
            <div class="card-sub">${l.note ? escapeHtml(l.note) : ''}</div>
            <div class="badges">
              <span class="badge">${l.role === 'owner' ? 'احتمالا مالک' : 'احتمالا مشتری'}</span>
              ${l.suggested_potential ? `<span class="badge ${l.suggested_potential}">پتانسیل ${LABELS.potential[l.suggested_potential]}</span>` : ''}
            </div>
          </div>
          <div class="card-actions">
            ${l.role === 'owner'
              ? `<button class="btn btn-primary btn-sm" data-action="lead-add-secondary" data-id="${escapeHtml(l._key)}">+ ملک سکندری</button>`
              : `<button class="btn btn-primary btn-sm" data-action="lead-add-customer" data-id="${escapeHtml(l._key)}">+ مشتری</button>`}
            <button class="btn btn-ghost btn-sm" data-action="lead-dismiss" data-id="${escapeHtml(l._key)}">نادیده بگیر</button>
          </div>
        </div>
      </div>
    `).join('');
}

function prefillFromLead(key, kind) {
  const lead = newLeads.find((l) => l._key === key);
  if (!lead) return;
  if (kind === 'customer') {
    $('#cName').value = lead.name || '';
    $('#cPhone').value = lead.phone || '';
    if (lead.suggested_potential) $('#cPotential').value = lead.suggested_potential;
    if (lead.note) $('#cNotes').value = lead.note;
  } else {
    $('#sName').value = lead.property_hint || lead.name || '';
    $('#sOwnerPhone').value = lead.phone || '';
    if (lead.note) $('#sDescription').value = lead.note;
  }
}

// ---------- auto-detected developer projects (data/projects.json) ----------
async function loadAutoProjects() {
  try {
    const res = await fetch('data/projects.json', { cache: 'no-store' });
    if (!res.ok) return;
    const raw = await res.json();
    autoProjects = (Array.isArray(raw) ? raw : []).map((p) => ({
      id: `auto:${p.developer_name}::${p.project_name}`,
      name: p.project_name,
      type: p.type === 'commercial' ? 'commercial' : 'residential',
      status: p.status || '',
      deliveryStatus: 'presale',
      location: p.location || '',
      price: p.price_range || '',
      notes: [p.note, p.event_type ? `(${p.event_type})` : ''].filter(Boolean).join(' '),
      priority: typeof p.priority === 'number' ? p.priority : 999,
      developerName: p.developer_name,
      sourceUrl: p.source_url || '',
      detectedAt: p.detected_at || '',
      auto: true,
    }));
  } catch {
    autoProjects = [];
  }
  renderProjects();
  renderFollowup();
  populateAssignedSelect();
}

// ---------- گزارش‌های تحلیل قیمت (reports/index.json) ----------
async function loadReportsIndex() {
  try {
    const res = await fetch('reports/index.json', { cache: 'no-store' });
    if (!res.ok) return;
    const raw = await res.json();
    reportsIndex = Array.isArray(raw) ? raw : [];
  } catch {
    reportsIndex = [];
  }
  renderReports();
}

function renderReports() {
  const container = $('#reportsList');
  if (!container) return;
  if (reportsIndex.length === 0) {
    container.innerHTML = '<p class="hint">هنوز گزارش تحلیل قیمتی ساخته نشده — از تب Actions در گیت‌هاب، «Generate price report» را دستی اجرا کنید.</p>';
    return;
  }
  const sorted = [...reportsIndex].sort((a, b) => (b.generatedAt || '').localeCompare(a.generatedAt || ''));
  container.innerHTML = `<p class="hint">📄 گزارش‌های تحلیل قیمت اخیر:</p>` +
    sorted.map((r) => `
      <div class="card">
        <div class="card-top">
          <div>
            <div class="card-name">${escapeHtml(r.title || r.slug)}</div>
            <div class="card-sub">${r.location ? escapeHtml(r.location) + ' · ' : ''}${r.generatedAt ? toFa(r.generatedAt.slice(0, 10)) : ''}</div>
          </div>
          <div class="card-actions">
            <a class="btn btn-ghost btn-sm" href="${escapeHtml(r.path)}" target="_blank" rel="noopener">مشاهده / اکسپورت</a>
          </div>
        </div>
      </div>
    `).join('');
}

// ترکیب پروژه‌های خودکار (تشخیص‌داده‌شده از سایت سازنده‌ها) با پروژه‌های دستی، مرتب‌شده بر اساس priority سازنده
function getAllProjects() {
  const manual = projects.map((p) => ({ ...p, priority: typeof p.priority === 'number' ? p.priority : 999, auto: false }));
  return [...autoProjects, ...manual].sort((a, b) => a.priority - b.priority);
}

// ---------- tabs ----------
$$('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.tab-btn').forEach((b) => b.classList.remove('active'));
    $$('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    $(`#tab-${btn.dataset.tab}`).classList.add('active');
  });
});

$('#todayDate').textContent = new Date().toLocaleDateString('fa-IR', {
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
});

// ==================================================================
// CUSTOMERS
// ==================================================================

function matchingPool(customer) {
  if (customer.subtype === 'presale') {
    return [...getAllProjects(), ...secondary.filter((s) => s.category === 'presale')];
  }
  return secondary.filter((s) => s.category === 'ready');
}

function suggestMatch(customer) {
  const pool = matchingPool(customer);
  if (customer.assignedId) {
    const found = pool.find((p) => p.id === customer.assignedId);
    if (found) return found;
  }
  return pool.find((p) => p.type === customer.type && p.status !== 'soldout' && p.status !== 'closed') || null;
}

function renderFollowup() {
  const container = $('#followupList');
  container.innerHTML = '';

  const due = customers
    .filter((c) => c.status !== 'purchasedElsewhere')
    .map((c) => {
      const interval = POTENTIAL_INTERVAL_DAYS[c.potential] || 21;
      const lastRef = c.lastFollowUp || c.firstMessageDate;
      const daysSince = lastRef ? daysBetween(lastRef, todayStr()) : Infinity;
      return { c, interval, daysSince, overdueBy: daysSince - interval };
    })
    .filter((x) => x.daysSince >= x.interval)
    .sort((a, b) => b.overdueBy - a.overdueBy);

  if (due.length === 0) {
    container.innerHTML = '<div class="empty-state">امروز هیچ مشتری‌ای برای پیام دادن سررسید نشده 🎉</div>';
    return;
  }

  due.forEach(({ c, daysSince }) => {
    const suggestion = suggestMatch(c);
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="card-top">
        <div>
          <div class="card-name">${escapeHtml(c.name)} ${c.phone ? `<span class="card-sub">(${escapeHtml(c.phone)})</span>` : ''}</div>
          <div class="card-sub">${LABELS.type[c.type]} · ${LABELS.subtype[c.subtype]} · ${daysSince === Infinity ? 'بدون فالوآپ قبلی' : `${daysSince} روز از آخرین فالوآپ`}</div>
          <div class="badges">
            <span class="badge ${c.potential}">پتانسیل ${LABELS.potential[c.potential]}</span>
            <span class="badge overdue">سررسید پیام</span>
            <span class="badge">${LABELS.status[c.status]}</span>
          </div>
        </div>
        <div class="card-actions">
          <button class="btn btn-primary btn-sm" data-action="mark-followup" data-id="${c.id}">ثبت پیام امروز</button>
          <button class="btn btn-ghost btn-sm" data-action="edit-customer" data-id="${c.id}">جزئیات</button>
        </div>
      </div>
      ${suggestion
        ? `<div class="followup-suggestion">📎 پیشنهاد ${c.subtype === 'presale' ? 'پروژه/ملک' : 'ملک'}: <strong>${escapeHtml(suggestion.name)}</strong> ${suggestion.location ? `— ${escapeHtml(suggestion.location)}` : ''}</div>`
        : `<div class="followup-suggestion">هنوز ${c.subtype === 'presale' ? 'پروژه/ملکی در بخش پیش‌فروش' : 'ملکی در سکندری - آماده'} برای پیشنهاد ثبت نشده.</div>`}
    `;
    container.appendChild(card);
  });
}

function renderCustomers() {
  const container = $('#customerList');
  const fType = $('#filterType').value;
  const fSubtype = $('#filterSubtype').value;
  const fPotential = $('#filterPotential').value;
  const fStatus = $('#filterStatus').value;
  const fSearch = $('#filterSearch').value.trim().toLowerCase();

  const filtered = customers.filter((c) =>
    (!fType || c.type === fType) &&
    (!fSubtype || c.subtype === fSubtype) &&
    (!fPotential || c.potential === fPotential) &&
    (!fStatus || c.status === fStatus) &&
    (!fSearch || c.name.toLowerCase().includes(fSearch) || (c.phone || '').includes(fSearch))
  );

  container.innerHTML = '';
  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state">مشتری‌ای یافت نشد. یک مشتری جدید اضافه کنید.</div>';
    return;
  }

  filtered.forEach((c) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="card-top">
        <div>
          <div class="card-name">${escapeHtml(c.name)} ${c.phone ? `<span class="card-sub">(${escapeHtml(c.phone)})</span>` : ''}</div>
          <div class="card-sub">
            اولین پیام: ${c.firstMessageDate ? toFa(c.firstMessageDate) : '—'} ·
            آخرین فالوآپ: ${c.lastFollowUp ? toFa(c.lastFollowUp) : '—'}
          </div>
          <div class="badges">
            <span class="badge">${LABELS.type[c.type]}</span>
            <span class="badge">${LABELS.subtype[c.subtype]}</span>
            <span class="badge ${c.potential}">${LABELS.potential[c.potential]}</span>
            <span class="badge">${LABELS.status[c.status]}</span>
            <span class="badge">${LABELS.interested[c.interested]}</span>
          </div>
        </div>
        <div class="card-actions">
          <button class="btn btn-ghost btn-sm" data-action="edit-customer" data-id="${c.id}">ویرایش</button>
        </div>
      </div>
      ${c.notes ? `<div class="followup-suggestion">${escapeHtml(c.notes)}</div>` : ''}
      ${renderInsightBanner(c.phone, { applyAction: 'apply-insight', applyId: c.id, appliedAt: c.lastInsightAppliedAt })}
    `;
    container.appendChild(card);
  });
}

['filterType', 'filterSubtype', 'filterPotential', 'filterStatus', 'filterSearch'].forEach((id) => {
  $(`#${id}`).addEventListener('input', renderCustomers);
});

document.body.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const { action, id, category } = btn.dataset;
  if (action === 'edit-customer') openCustomerModal(id);
  if (action === 'mark-followup') {
    const c = customers.find((x) => x.id === id);
    if (c) { c.lastFollowUp = todayStr(); persistCustomers(); renderFollowup(); renderCustomers(); }
  }
  if (action === 'apply-insight') applyInsight(id);
  if (action === 'edit-project') openProjectModal(id);
  if (action === 'add-secondary') openSecondaryModal(null, category);
  if (action === 'edit-secondary') openSecondaryModal(id);
  if (action === 'lead-add-customer') { openCustomerModal(null); prefillFromLead(id, 'customer'); }
  if (action === 'lead-add-secondary') { openSecondaryModal(null, 'ready'); prefillFromLead(id, 'owner'); }
  if (action === 'lead-dismiss') {
    dismissedLeads.add(id);
    persistDismissedLeads();
    renderNewLeads();
  }
});

function applyInsight(id) {
  const record = customers.find((x) => x.id === id);
  if (!record) return;
  const insight = findInsightForPhone(record.phone);
  if (!insight) return;
  if (insight.suggested_potential) record.potential = insight.suggested_potential;
  if (insight.suggested_interested && insight.suggested_interested !== 'unknown') record.interested = insight.suggested_interested;
  if (insight.last_message_at) record.lastFollowUp = insight.last_message_at.slice(0, 10);
  record.lastInsightAppliedAt = insight.updated_at;
  persistCustomers();
  renderCustomers();
  renderFollowup();
}

// ---------- Customer modal ----------
const customerModal = $('#customerModal');

function populateAssignedSelect() {
  const subtype = $('#cSubtype').value;
  const pool = subtype === 'presale'
    ? [...getAllProjects(), ...secondary.filter((s) => s.category === 'presale')]
    : secondary.filter((s) => s.category === 'ready');
  const select = $('#cAssigned');
  const current = select.value;
  select.innerHTML = '<option value="">— بدون تخصیص (پیشنهاد خودکار) —</option>' +
    pool.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}${p.auto ? ' 🤖' : ''}</option>`).join('');
  if (pool.some((p) => p.id === current)) select.value = current;
}
$('#cSubtype').addEventListener('change', populateAssignedSelect);

function openCustomerModal(id) {
  const c = id ? customers.find((x) => x.id === id) : null;
  $('#customerModalTitle').textContent = c ? 'ویرایش مشتری' : 'مشتری جدید';
  $('#cId').value = c ? c.id : '';
  $('#cName').value = c ? c.name : '';
  $('#cPhone').value = c ? c.phone || '' : '';
  $('#cType').value = c ? c.type : 'residential';
  $('#cSubtype').value = c ? c.subtype : 'presale';
  $('#cPotential').value = c ? c.potential : 'medium';
  $('#cInterested').value = c ? c.interested : 'unknown';
  $('#cFirstMsgDate').value = c ? c.firstMessageDate || '' : '';
  $('#cLastFollowUp').value = c ? c.lastFollowUp || '' : todayStr();
  $('#cStatus').value = c ? c.status : 'following';
  $('#cNotes').value = c ? c.notes || '' : '';
  populateAssignedSelect();
  if (c) $('#cAssigned').value = c.assignedId || '';
  $('#btnDeleteCustomer').classList.toggle('hidden', !c);
  $('#chatAnalysisResult').classList.add('hidden');
  $('#chatFile').value = '';
  customerModal.classList.remove('hidden');
}

$('#btnAddCustomer').addEventListener('click', () => openCustomerModal(null));
$('#btnCancelCustomer').addEventListener('click', () => customerModal.classList.add('hidden'));

$('#customerForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = $('#cId').value || uid();
  const existing = customers.find((x) => x.id === id);
  const data = {
    id,
    name: $('#cName').value.trim(),
    phone: $('#cPhone').value.trim(),
    type: $('#cType').value,
    subtype: $('#cSubtype').value,
    potential: $('#cPotential').value,
    interested: $('#cInterested').value,
    firstMessageDate: $('#cFirstMsgDate').value,
    lastFollowUp: $('#cLastFollowUp').value,
    status: $('#cStatus').value,
    assignedId: $('#cAssigned').value || null,
    notes: $('#cNotes').value.trim(),
    lastInsightAppliedAt: existing ? existing.lastInsightAppliedAt : null,
  };
  const idx = customers.findIndex((x) => x.id === id);
  if (idx >= 0) customers[idx] = data; else customers.push(data);
  persistCustomers();
  customerModal.classList.add('hidden');
  renderFollowup();
  renderCustomers();
});

$('#btnDeleteCustomer').addEventListener('click', () => {
  const id = $('#cId').value;
  if (!id) return;
  if (!confirm('این مشتری حذف شود؟')) return;
  customers = customers.filter((x) => x.id !== id);
  persistCustomers();
  customerModal.classList.add('hidden');
  renderFollowup();
  renderCustomers();
});

// ==================================================================
// CHAT EXPORT ANALYZER
// ==================================================================

const INTEREST_KEYWORDS = ['قیمت', 'متراژ', 'بازدید', 'ویو ', 'رهن', 'قسط', 'وام', 'چک', 'پیش‌پرداخت', 'پیش پرداخت', 'قرارداد', 'بیعانه', 'تحویل', 'سند', 'متری', 'نقشه', 'پارکینگ', 'آسانسور', 'موقعیت'];
const DISINTEREST_KEYWORDS = ['فعلا نه', 'فعلاً نه', 'بعدا صحبت', 'بعداً صحبت', 'وقت ندارم', 'گرون', 'گران', 'بودجه ندارم', 'منصرف', 'نیاز ندارم', 'دیگه پیام ندید', 'دیگه پیام ندهید', 'مسافرت', 'صبر کنید'];

function parseWhatsAppExport(text) {
  const lineRegex = /^[\[]?(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|am|pm|ب\.ظ|ق\.ظ)?[\]]?\s*[-–]\s*([^:]{1,60}):\s*(.*)$/;
  const lines = text.split(/\r?\n/);
  const messages = [];
  let current = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(lineRegex);
    if (m) {
      if (current) messages.push(current);
      const [, d, mo, y, h, mi, , ampm, sender, body] = m;
      let year = parseInt(y, 10); if (year < 100) year += 2000;
      let hour = parseInt(h, 10);
      if (ampm) {
        const ap = ampm.toLowerCase();
        if ((ap === 'pm' || ap === 'ب.ظ') && hour < 12) hour += 12;
        if ((ap === 'am' || ap === 'ق.ظ') && hour === 12) hour = 0;
      }
      const date = new Date(year, parseInt(mo, 10) - 1, parseInt(d, 10), hour, parseInt(mi, 10));
      current = { date, sender: sender.trim(), text: body };
    } else if (current) {
      current.text += '\n' + line;
    }
  }
  if (current) messages.push(current);
  return messages.filter((m) => !isNaN(m.date.getTime()));
}

function analyzeChat(text, myName) {
  const messages = parseWhatsAppExport(text);
  if (messages.length === 0) {
    return { error: 'نتوانستم پیامی را از این فایل استخراج کنم. مطمئن شوید فایل، خروجی «Export Chat» واتساپ (txt) است.' };
  }

  messages.sort((a, b) => a.date - b.date);
  const first = messages[0].date;
  const last = messages[messages.length - 1].date;

  let customerMsgs = messages;
  let replyRatio = null;
  if (myName && myName.trim()) {
    const needle = myName.trim().toLowerCase();
    const mine = messages.filter((m) => m.sender.toLowerCase().includes(needle));
    customerMsgs = messages.filter((m) => !m.sender.toLowerCase().includes(needle));
    if (mine.length + customerMsgs.length > 0) {
      replyRatio = customerMsgs.length / messages.length;
    }
  }

  const customerText = customerMsgs.map((m) => m.text).join(' \n ');
  const posHits = INTEREST_KEYWORDS.reduce((n, k) => n + (customerText.includes(k) ? 1 : 0), 0);
  const negHits = DISINTEREST_KEYWORDS.reduce((n, k) => n + (customerText.includes(k) ? 1 : 0), 0);

  const daysSinceLast = daysBetween(last.toISOString().slice(0, 10), todayStr());
  let score = posHits * 2 - negHits * 3 + (replyRatio !== null ? replyRatio * 10 : 0);
  score += daysSinceLast > 45 ? -5 : daysSinceLast > 20 ? -2 : 0;

  let suggestedPotential = 'low';
  if (score >= 8) suggestedPotential = 'high';
  else if (score >= 3) suggestedPotential = 'medium';

  let suggestedInterested = 'unknown';
  if (replyRatio !== null) suggestedInterested = replyRatio >= 0.3 ? 'yes' : 'no';

  return {
    totalMessages: messages.length,
    customerMessages: customerMsgs.length,
    firstMessageDate: first.toISOString().slice(0, 10),
    lastMessageDate: last.toISOString().slice(0, 10),
    replyRatio,
    posHits,
    negHits,
    suggestedPotential,
    suggestedInterested,
  };
}

$('#chatFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  const myName = prompt('نام شما همان‌طور که در این چت واتساپ نمایش داده می‌شود چیست؟ (برای محاسبه دقیق‌تر پاسخگویی — اختیاری، Cancel هم می‌زنید مشکلی نیست)') || '';
  const result = analyzeChat(text, myName);
  const box = $('#chatAnalysisResult');
  box.classList.remove('hidden');

  if (result.error) {
    box.innerHTML = `⚠️ ${result.error}`;
    return;
  }

  box.innerHTML = `
    📊 <strong>پیشنهاد سیستم (تقریبی — حتماً بررسی کنید)</strong><br>
    تعداد کل پیام‌ها: ${result.totalMessages}<br>
    اولین پیام: ${toFa(result.firstMessageDate)}<br>
    آخرین پیام: ${toFa(result.lastMessageDate)}<br>
    ${result.replyRatio !== null ? `نسبت پاسخ‌دهی مشتری: ${(result.replyRatio * 100).toFixed(0)}٪<br>` : 'برای محاسبه دقیق نسبت پاسخ‌دهی، نام خودتان را وارد نکردید.<br>'}
    پتانسیل پیشنهادی: <strong>${LABELS.potential[result.suggestedPotential]}</strong><br>
    علاقه‌مندی پیشنهادی: <strong>${LABELS.interested[result.suggestedInterested]}</strong>
    <div><button type="button" class="btn btn-primary btn-sm apply-btn" id="btnApplyAnalysis">اعمال روی فرم</button></div>
  `;

  $('#btnApplyAnalysis').addEventListener('click', () => {
    $('#cFirstMsgDate').value = result.firstMessageDate;
    $('#cLastFollowUp').value = result.lastMessageDate;
    $('#cPotential').value = result.suggestedPotential;
    if (result.suggestedInterested !== 'unknown') $('#cInterested').value = result.suggestedInterested;
  });
});

// ==================================================================
// PROJECTS (پرایمری — مستقیم از سازنده — جایگزین داخلی «ریلی»)
// ==================================================================

function renderProjects() {
  const container = $('#projectList');
  container.innerHTML = '';
  const all = getAllProjects();
  if (all.length === 0) {
    container.innerHTML = '<div class="empty-state">هنوز پروژه‌ای ثبت نشده.</div>';
    return;
  }
  all.forEach((p) => {
    const card = document.createElement('div');
    card.className = 'card';
    const statusBadge = p.auto ? escapeHtml(p.status || '—') : (p.status === 'soldout' ? 'تکمیل ظرفیت' : 'فعال');
    card.innerHTML = `
      <div class="card-top">
        <div>
          <div class="card-name">${escapeHtml(p.name)} ${p.auto ? '<span class="card-sub">🤖 خودکار — از سایت ' + escapeHtml(p.developerName || '') + '</span>' : ''}</div>
          <div class="card-sub">${LABELS.type[p.type]} ${p.location ? '· ' + escapeHtml(p.location) : ''} ${p.price ? '· ' + escapeHtml(p.price) : ''} ${p.auto ? '· اولویت سازنده ' + p.priority : ''}</div>
          <div class="badges">
            <span class="badge">${statusBadge}</span>
            ${p.deliveryStatus === 'ready' ? '<span class="badge">🏠 آماده (مستقیم از سازنده)</span>' : ''}
          </div>
        </div>
        <div class="card-actions">
          ${p.auto
            ? (p.sourceUrl ? `<a class="btn btn-ghost btn-sm" href="${escapeHtml(p.sourceUrl)}" target="_blank" rel="noopener">منبع</a>` : '')
            : `<button class="btn btn-ghost btn-sm" data-action="edit-project" data-id="${p.id}">ویرایش</button>`}
        </div>
      </div>
      ${p.notes ? `<div class="followup-suggestion">${escapeHtml(p.notes)}</div>` : ''}
    `;
    container.appendChild(card);
  });
}

const projectModal = $('#projectModal');
function openProjectModal(id) {
  const p = id ? projects.find((x) => x.id === id) : null;
  $('#projectModalTitle').textContent = p ? 'ویرایش پروژه' : 'پروژه پیش‌فروش جدید';
  $('#pId').value = p ? p.id : '';
  $('#pName').value = p ? p.name : '';
  $('#pType').value = p ? p.type : 'residential';
  $('#pStatus').value = p ? p.status : 'active';
  $('#pDeliveryStatus').value = p ? p.deliveryStatus || 'presale' : 'presale';
  $('#pLocation').value = p ? p.location || '' : '';
  $('#pPrice').value = p ? p.price || '' : '';
  $('#pNotes').value = p ? p.notes || '' : '';
  $('#btnDeleteProject').classList.toggle('hidden', !p);
  projectModal.classList.remove('hidden');
}
$('#btnAddProject').addEventListener('click', () => openProjectModal(null));
$('#btnCancelProject').addEventListener('click', () => projectModal.classList.add('hidden'));
$('#projectForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = $('#pId').value || uid();
  const data = {
    id, name: $('#pName').value.trim(), type: $('#pType').value, status: $('#pStatus').value,
    deliveryStatus: $('#pDeliveryStatus').value,
    location: $('#pLocation').value.trim(), price: $('#pPrice').value.trim(), notes: $('#pNotes').value.trim(),
  };
  const idx = projects.findIndex((x) => x.id === id);
  if (idx >= 0) projects[idx] = data; else projects.push(data);
  persistProjects();
  projectModal.classList.add('hidden');
  renderProjects(); renderFollowup(); populateAssignedSelect();
});
$('#btnDeleteProject').addEventListener('click', () => {
  const id = $('#pId').value;
  if (!id || !confirm('این پروژه حذف شود؟')) return;
  projects = projects.filter((x) => x.id !== id);
  persistProjects();
  projectModal.classList.add('hidden');
  renderProjects(); renderFollowup(); populateAssignedSelect();
});

// ==================================================================
// SECONDARY (سکندری - پیش‌فروش / آماده / اجاره) — با اطلاعات مالک
// ==================================================================

// شماره رو به فرمت بین‌المللی ایران (بدون + یا صفر ابتدایی) تبدیل می‌کنه، برای ساخت لینک واتساپ/تلگرام
function toIntlIranPhone(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('0')) digits = '98' + digits.slice(1);
  else if (!digits.startsWith('98') && digits.length === 10) digits = '98' + digits;
  return digits;
}

function contactLink(phone, platform) {
  const intl = toIntlIranPhone(phone);
  if (!intl) return '';
  return platform === 'telegram' ? `https://t.me/+${intl}` : `https://wa.me/${intl}`;
}

const SECONDARY_CONTAINERS = { presale: 'secPresaleList', ready: 'secReadyList', rent: 'secRentList' };

function renderSecondaryTab(category) {
  const container = $(`#${SECONDARY_CONTAINERS[category]}`);
  if (!container) return;
  const items = secondary.filter((s) => s.category === category);
  container.innerHTML = '';
  if (items.length === 0) {
    container.innerHTML = '<div class="empty-state">هنوز ملکی در این بخش ثبت نشده.</div>';
    return;
  }
  items.forEach((s) => {
    const card = document.createElement('div');
    card.className = 'card';
    const link = s.ownerPhone ? contactLink(s.ownerPhone, s.contactPlatform) : '';
    card.innerHTML = `
      <div class="card-top">
        <div>
          <div class="card-name">${escapeHtml(s.name)}</div>
          <div class="card-sub">${LABELS.type[s.type]} ${s.location ? '· ' + escapeHtml(s.location) : ''} ${s.area ? '· ' + escapeHtml(s.area) : ''} ${s.price ? '· ' + escapeHtml(s.price) : ''}</div>
          <div class="card-sub">${s.ownerPhone ? 'مالک: ' + escapeHtml(s.ownerPhone) : 'شماره مالک ثبت نشده'}</div>
          <div class="badges">
            <span class="badge">${LABELS.secStatus[s.status] || 'فعال'}</span>
            ${!s.driveLink ? '<span class="badge overdue">⚠️ بدون عکس/ویدیو</span>' : ''}
          </div>
        </div>
        <div class="card-actions">
          ${link ? `<a class="btn btn-ghost btn-sm" href="${escapeHtml(link)}" target="_blank" rel="noopener">${LABELS.contactPlatform[s.contactPlatform] || 'واتساپ'}</a>` : ''}
          ${s.driveLink ? `<a class="btn btn-ghost btn-sm" href="${escapeHtml(s.driveLink)}" target="_blank" rel="noopener">درایو</a>` : ''}
          <button class="btn btn-ghost btn-sm" data-action="edit-secondary" data-id="${s.id}">ویرایش</button>
        </div>
      </div>
      ${!s.driveLink ? '<div class="followup-suggestion insight-banner">📸 این ملک هنوز عکس/ویدیو در گوگل درایو نداره — از مالک بخواید و لینکش رو ثبت کنید.</div>' : ''}
      ${s.description ? `<div class="followup-suggestion">${escapeHtml(s.description)}</div>` : ''}
      ${renderInsightBanner(s.ownerPhone)}
    `;
    container.appendChild(card);
  });
}

const secondaryModal = $('#secondaryModal');
function openSecondaryModal(id, presetCategory) {
  const s = id ? secondary.find((x) => x.id === id) : null;
  $('#secondaryModalTitle').textContent = s ? 'ویرایش ملک' : `ملک ${LABELS.secCategory[presetCategory] || ''} جدید`;
  $('#sId').value = s ? s.id : '';
  $('#sCategory').value = s ? s.category : (presetCategory || 'ready');
  $('#sName').value = s ? s.name : '';
  $('#sType').value = s ? s.type : 'residential';
  $('#sStatus').value = s ? s.status : 'active';
  $('#sLocation').value = s ? s.location || '' : '';
  $('#sArea').value = s ? s.area || '' : '';
  $('#sPrice').value = s ? s.price || '' : '';
  $('#sDescription').value = s ? s.description || '' : '';
  $('#sOwnerPhone').value = s ? s.ownerPhone || '' : '';
  $('#sContactPlatform').value = s ? s.contactPlatform || 'whatsapp' : 'whatsapp';
  $('#sDriveLink').value = s ? s.driveLink || '' : '';
  $('#btnDeleteSecondary').classList.toggle('hidden', !s);
  secondaryModal.classList.remove('hidden');
}
$('#btnCancelSecondary').addEventListener('click', () => secondaryModal.classList.add('hidden'));
$('#secondaryForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = $('#sId').value || uid();
  const data = {
    id,
    category: $('#sCategory').value,
    name: $('#sName').value.trim(),
    type: $('#sType').value,
    status: $('#sStatus').value,
    location: $('#sLocation').value.trim(),
    area: $('#sArea').value.trim(),
    price: $('#sPrice').value.trim(),
    description: $('#sDescription').value.trim(),
    ownerPhone: $('#sOwnerPhone').value.trim(),
    contactPlatform: $('#sContactPlatform').value,
    driveLink: $('#sDriveLink').value.trim(),
  };
  const idx = secondary.findIndex((x) => x.id === id);
  if (idx >= 0) secondary[idx] = data; else secondary.push(data);
  persistSecondary();
  secondaryModal.classList.add('hidden');
  renderSecondaryTab(data.category);
  renderFollowup(); populateAssignedSelect(); renderNewLeads();
});
$('#btnDeleteSecondary').addEventListener('click', () => {
  const id = $('#sId').value;
  const item = secondary.find((x) => x.id === id);
  if (!id || !item || !confirm('این ملک حذف شود؟')) return;
  secondary = secondary.filter((x) => x.id !== id);
  persistSecondary();
  secondaryModal.classList.add('hidden');
  renderSecondaryTab(item.category);
  renderFollowup(); populateAssignedSelect();
});

// ==================================================================
// BACKUP EXPORT / IMPORT
// ==================================================================

$('#btnExport').addEventListener('click', () => {
  const payload = { customers, projects, secondary, exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `client-tracker-backup-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    if (!confirm('این کار داده‌های فعلی را با فایل پشتیبان جایگزین می‌کند. ادامه می‌دهید؟')) return;
    customers = payload.customers || [];
    projects = payload.projects || [];
    secondary = payload.secondary || payload.listings || [];
    persistCustomers(); persistProjects(); persistSecondary();
    renderAll();
  } catch {
    alert('فایل پشتیبان معتبر نیست.');
  }
  e.target.value = '';
});

// خروجی لیست شماره‌های شناخته‌شده (مشتری‌ها + مالک‌های ثبت‌شده روی ملک‌ها) برای ربات واتساپ متصل به شماره اصلی
// (whatsapp-bot-clients) — این فایل را دانلود و به صورت دستی جای data/contacts.json در ریپازیتوری commit کنید.
// برای هر مالک، عنوان ملک‌های ثبت‌شده‌اش هم فرستاده می‌شه تا ربات بفهمه اگه حرف از یک ملک دیگه زد، تازه‌ست.
$('#btnExportWatchlist').addEventListener('click', () => {
  const ownerMap = new Map();
  secondary.filter((s) => s.ownerPhone).forEach((s) => {
    const key = normalizePhone(s.ownerPhone);
    if (!ownerMap.has(key)) ownerMap.set(key, { phone: s.ownerPhone, name: s.name, role: 'owner', properties: [] });
    ownerMap.get(key).properties.push(s.name);
  });
  const contacts = [
    ...customers.filter((c) => c.phone).map((c) => ({ phone: c.phone, name: c.name, role: 'customer' })),
    ...Array.from(ownerMap.values()),
  ];
  const blob = new Blob([JSON.stringify(contacts, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'contacts.json';
  a.click();
  URL.revokeObjectURL(url);
  alert('فایل contacts.json دانلود شد. آن را جایگزین data/contacts.json در ریپازیتوری گیت‌هاب کنید (راهنما: whatsapp-bot-clients/README.md).');
});

// ---------- misc utils ----------
function toFa(isoDate) {
  if (!isoDate) return '—';
  return new Date(isoDate).toLocaleDateString('fa-IR');
}
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderAll() {
  renderFollowup();
  renderCustomers();
  renderProjects();
  renderSecondaryTab('presale');
  renderSecondaryTab('ready');
  renderSecondaryTab('rent');
  populateAssignedSelect();
}

renderAll();
loadContactInsights();
loadAutoProjects();
loadNewLeads();
loadReportsIndex();
