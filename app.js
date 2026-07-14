// ------------------------------------------------------------------
// پیگیری مشتریان واتساپ — ذخیره‌سازی کامل در localStorage مرورگر
// ------------------------------------------------------------------

const STORAGE_KEYS = {
  customers: 'wct_customers',
  projects: 'wct_projects',
  listings: 'wct_listings',
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

let customers = loadArr(STORAGE_KEYS.customers);
let projects = loadArr(STORAGE_KEYS.projects);
let listings = loadArr(STORAGE_KEYS.listings);
let autoProjects = []; // fetched from data/projects.json (developer news monitor)

const persistCustomers = () => saveArr(STORAGE_KEYS.customers, customers);
const persistProjects = () => saveArr(STORAGE_KEYS.projects, projects);
const persistListings = () => saveArr(STORAGE_KEYS.listings, listings);

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
  return customer.subtype === 'presale' ? getAllProjects() : listings;
}

function suggestMatch(customer) {
  const pool = matchingPool(customer);
  if (customer.assignedId) {
    const found = pool.find((p) => p.id === customer.assignedId);
    if (found) return found;
  }
  return pool.find((p) => p.type === customer.type && p.status !== 'soldout') || null;
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
        ? `<div class="followup-suggestion">📎 پیشنهاد ${c.subtype === 'presale' ? 'پروژه' : 'ملک'}: <strong>${escapeHtml(suggestion.name)}</strong> ${suggestion.location ? `— ${escapeHtml(suggestion.location)}` : ''}</div>`
        : `<div class="followup-suggestion">هنوز ${c.subtype === 'presale' ? 'پروژه‌ای در بخش پیش‌فروش' : 'ملکی در فایل بازار ثانویه'} برای پیشنهاد ثبت نشده.</div>`}
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
  const { action, id } = btn.dataset;
  if (action === 'edit-customer') openCustomerModal(id);
  if (action === 'mark-followup') {
    const c = customers.find((x) => x.id === id);
    if (c) { c.lastFollowUp = todayStr(); persistCustomers(); renderFollowup(); renderCustomers(); }
  }
  if (action === 'edit-project') openProjectModal(id);
  if (action === 'edit-listing') openListingModal(id);
});

// ---------- Customer modal ----------
const customerModal = $('#customerModal');

function populateAssignedSelect() {
  const subtype = $('#cSubtype').value;
  const pool = subtype === 'presale' ? getAllProjects() : listings;
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
// PROJECTS (پیش‌فروش — جایگزین داخلی «ریلی»)
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
          <div class="badges"><span class="badge">${statusBadge}</span></div>
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
// LISTINGS (بازار ثانویه/آماده — فایل خود کاربر)
// ==================================================================

function renderListings() {
  const container = $('#listingList');
  container.innerHTML = '';
  if (listings.length === 0) {
    container.innerHTML = '<div class="empty-state">هنوز ملکی ثبت نشده.</div>';
    return;
  }
  listings.forEach((l) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="card-top">
        <div>
          <div class="card-name">${escapeHtml(l.name)}</div>
          <div class="card-sub">${LABELS.type[l.type]} ${l.location ? '· ' + escapeHtml(l.location) : ''} ${l.price ? '· ' + escapeHtml(l.price) : ''}</div>
          <div class="badges"><span class="badge">${l.status === 'soldout' ? 'فروخته شده' : 'فعال'}</span></div>
        </div>
        <div class="card-actions">
          <button class="btn btn-ghost btn-sm" data-action="edit-listing" data-id="${l.id}">ویرایش</button>
        </div>
      </div>
      ${l.notes ? `<div class="followup-suggestion">${escapeHtml(l.notes)}</div>` : ''}
    `;
    container.appendChild(card);
  });
}

const listingModal = $('#listingModal');
function openListingModal(id) {
  const l = id ? listings.find((x) => x.id === id) : null;
  $('#listingModalTitle').textContent = l ? 'ویرایش ملک' : 'ملک بازار ثانویه جدید';
  $('#lId').value = l ? l.id : '';
  $('#lName').value = l ? l.name : '';
  $('#lType').value = l ? l.type : 'residential';
  $('#lStatus').value = l ? l.status : 'active';
  $('#lLocation').value = l ? l.location || '' : '';
  $('#lPrice').value = l ? l.price || '' : '';
  $('#lNotes').value = l ? l.notes || '' : '';
  $('#btnDeleteListing').classList.toggle('hidden', !l);
  listingModal.classList.remove('hidden');
}
$('#btnAddListing').addEventListener('click', () => openListingModal(null));
$('#btnCancelListing').addEventListener('click', () => listingModal.classList.add('hidden'));
$('#listingForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = $('#lId').value || uid();
  const data = {
    id, name: $('#lName').value.trim(), type: $('#lType').value, status: $('#lStatus').value,
    location: $('#lLocation').value.trim(), price: $('#lPrice').value.trim(), notes: $('#lNotes').value.trim(),
  };
  const idx = listings.findIndex((x) => x.id === id);
  if (idx >= 0) listings[idx] = data; else listings.push(data);
  persistListings();
  listingModal.classList.add('hidden');
  renderListings(); renderFollowup(); populateAssignedSelect();
});
$('#btnDeleteListing').addEventListener('click', () => {
  const id = $('#lId').value;
  if (!id || !confirm('این ملک حذف شود؟')) return;
  listings = listings.filter((x) => x.id !== id);
  persistListings();
  listingModal.classList.add('hidden');
  renderListings(); renderFollowup(); populateAssignedSelect();
});

// ==================================================================
// BACKUP EXPORT / IMPORT
// ==================================================================

$('#btnExport').addEventListener('click', () => {
  const payload = { customers, projects, listings, exportedAt: new Date().toISOString() };
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
    listings = payload.listings || [];
    persistCustomers(); persistProjects(); persistListings();
    renderAll();
  } catch {
    alert('فایل پشتیبان معتبر نیست.');
  }
  e.target.value = '';
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
  renderListings();
  populateAssignedSelect();
}

renderAll();
loadAutoProjects();
