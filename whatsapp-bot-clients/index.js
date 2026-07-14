// Persistent WhatsApp listener on your MAIN number: reads ALL 1-1 chats
// EXCEPT the numbers listed in config/excluded-numbers.json. For numbers
// already known (customers, or property owners attached to a listing —
// both exported from the app into data/contacts.json), it updates
// data/contact-insights.json. For unknown numbers, it asks Claude whether
// the conversation looks like a real-estate customer or property-owner
// lead; if so it's written to data/new-leads.json for you to review and
// add in the app. Anything judged irrelevant (personal chats, etc.) is
// never stored anywhere.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const qrcode = require('qrcode-terminal');
const { Boom } = require('@hapi/boom');
const Anthropic = require('@anthropic-ai/sdk');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
} = require('@whiskeysockets/baileys');

const AUTH_DIR = process.env.WHATSAPP_AUTH_DIR || path.join(__dirname, 'auth_info');
const DATA_REPO_DIR = process.env.DATA_REPO_DIR || path.join(__dirname, 'data-repo');
const GIT_BRANCH = process.env.GIT_BRANCH || 'Main';
const GIT_USER_NAME = process.env.GIT_USER_NAME || 'whatsapp-contacts-bot';
const GIT_USER_EMAIL = process.env.GIT_USER_EMAIL || 'bot@localhost';
const SYNC_DEBOUNCE_MS = Number(process.env.SYNC_DEBOUNCE_MS || 30000);
const ANALYSIS_DEBOUNCE_MS = Number(process.env.ANALYSIS_DEBOUNCE_MS || 15000);
const MAX_BUFFER_MESSAGES = 20;
const MODEL = 'claude-opus-4-8';

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY تنظیم نشده. برنامه متوقف شد.');
  process.exit(1);
}
if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPO) {
  console.error('GITHUB_TOKEN و GITHUB_REPO (مثلا mozhgankia/Client_tracker) باید تنظیم شده باشند.');
  process.exit(1);
}

const GIT_REMOTE_URL = `https://x-access-token:${process.env.GITHUB_TOKEN}@github.com/${process.env.GITHUB_REPO}.git`;

const client = new Anthropic();

// برای مخاطب‌های شناخته‌شده (مشتری) — فقط پتانسیل/علاقه‌مندی
const CUSTOMER_INSIGHT_SCHEMA = {
  type: 'object',
  properties: {
    suggested_potential: { type: 'string', enum: ['high', 'medium', 'low'] },
    suggested_interested: { type: 'string', enum: ['yes', 'no', 'unknown'] },
    note: { type: 'string', description: 'خلاصه یک جمله‌ای از وضعیت فعلی این مخاطب بر اساس پیام‌های اخیر' },
  },
  required: ['suggested_potential', 'suggested_interested', 'note'],
  additionalProperties: false,
};

// برای مخاطب‌های ناشناس — اول باید تشخیص بدیم اصلاً مرتبط با کار املاک هست یا نه
const LEAD_CLASSIFICATION_SCHEMA = {
  type: 'object',
  properties: {
    is_relevant: { type: 'boolean', description: 'آیا این گفتگو نشان می‌دهد طرف مخاطب یک مشتری بالقوه خرید ملک یا مالک ملکی است که ممکن است بخواهد بفروشد؟' },
    role: { type: 'string', enum: ['customer', 'owner', 'not_relevant'] },
    suggested_potential: { type: 'string', enum: ['high', 'medium', 'low'] },
    property_hint: { type: 'string', description: 'اگر role=owner است، توضیح مختصر ملکی که مالک از آن صحبت کرده؛ در غیر این صورت رشته خالی' },
    note: { type: 'string', description: 'یک جمله خلاصه از چرایی این تشخیص' },
  },
  required: ['is_relevant', 'role', 'suggested_potential', 'property_hint', 'note'],
  additionalProperties: false,
};

// ---------- git-backed data store (independent clone from the bot's own code checkout) ----------

function git(args) {
  return execFileSync('git', args, {
    cwd: DATA_REPO_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
}

function ensureDataRepo() {
  if (fs.existsSync(path.join(DATA_REPO_DIR, '.git'))) {
    try {
      git(['pull', '--rebase', 'origin', GIT_BRANCH]);
    } catch (err) {
      console.warn('git pull ناموفق بود، با نسخه محلی ادامه می‌دهیم:', err.message);
    }
    return;
  }
  fs.mkdirSync(path.dirname(DATA_REPO_DIR), { recursive: true });
  execFileSync('git', ['clone', '--branch', GIT_BRANCH, GIT_REMOTE_URL, DATA_REPO_DIR], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  git(['config', 'user.name', GIT_USER_NAME]);
  git(['config', 'user.email', GIT_USER_EMAIL]);
}

function loadJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function saveJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// شماره تماس رو نرمال می‌کنه (فقط رقم، ۱۰ رقم آخر) — دقیقا مشابه app.js
function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '').slice(-10);
}

function loadExcludedNumbers() {
  const config = loadJson(path.join(DATA_REPO_DIR, 'config', 'excluded-numbers.json'), { numbers: [] });
  const numbers = Array.isArray(config.numbers) ? config.numbers : [];
  return new Set(numbers.map(normalizePhone));
}

function loadKnownContacts() {
  const contacts = loadJson(path.join(DATA_REPO_DIR, 'data', 'contacts.json'), []);
  return Array.isArray(contacts) ? contacts : [];
}

let pendingChanges = new Set(); // relative file paths with pending changes
let syncTimer = null;

function scheduleSync(relativeFilePath) {
  pendingChanges.add(relativeFilePath);
  if (syncTimer) return;
  syncTimer = setTimeout(() => {
    syncTimer = null;
    syncToRepo().catch((err) => console.error('sync failed:', err.message));
  }, SYNC_DEBOUNCE_MS);
}

async function syncToRepo() {
  if (pendingChanges.size === 0) return;
  const files = Array.from(pendingChanges);
  pendingChanges = new Set();

  try {
    git(['pull', '--rebase', 'origin', GIT_BRANCH]);
  } catch (err) {
    console.warn('git pull قبل از push ناموفق بود:', err.message);
  }

  git(['add', ...files]);
  let status;
  try {
    status = git(['status', '--porcelain']);
  } catch {
    status = '';
  }
  if (!status.trim()) {
    console.log('چیزی برای commit نبود.');
    return;
  }

  git(['commit', '-m', 'chore: update contact insights from WhatsApp [automated]']);
  try {
    git(['push', 'origin', `HEAD:${GIT_BRANCH}`]);
    console.log('✅ تغییرات با موفقیت push شد.');
  } catch (err) {
    console.warn('push اول ناموفق بود، یک بار دیگر تلاش می‌کنیم:', err.message);
    git(['pull', '--rebase', 'origin', GIT_BRANCH]);
    git(['push', 'origin', `HEAD:${GIT_BRANCH}`]);
    console.log('✅ تغییرات در تلاش دوم push شد.');
  }
}

// ---------- Claude analysis ----------

async function analyzeCustomer(name, transcriptLines) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    output_config: { format: { type: 'json_schema', schema: CUSTOMER_INSIGHT_SCHEMA } },
    messages: [
      {
        role: 'user',
        content:
          `شما دستیار یک مشاور املاک هستید. متن زیر چند پیام اخیر واتساپ بین مشاور و مشتری «${name}» است. ` +
          `«من:» یعنی پیام از طرف مشاور، بقیه خطوط پیام‌های خود مشتری است.\n\n` +
          `بر اساس این گفتگو:\n- suggested_potential: احتمال خرید این مشتری (زیاد/متوسط/کم)\n` +
          `- suggested_interested: آیا این مخاطب معمولاً به پیام‌ها جواب می‌دهد؟\n- note: یک جمله خلاصه از وضعیت فعلی.\n\n` +
          `گفتگو:\n"""\n${transcriptLines.join('\n')}\n"""`,
      },
    ],
  });
  if (response.stop_reason === 'refusal') return null;
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) return null;
  try {
    return JSON.parse(textBlock.text);
  } catch {
    return null;
  }
}

async function classifyUnknownContact(name, transcriptLines) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    output_config: { format: { type: 'json_schema', schema: LEAD_CLASSIFICATION_SCHEMA } },
    messages: [
      {
        role: 'user',
        content:
          `شما دستیار یک مشاور املاک هستید. متن زیر چند پیام اخیر واتساپ بین مشاور و «${name}» است — ` +
          `کسی که هنوز در سیستم مشتری‌ها یا فایل ملک‌ها ثبت نشده. «من:» یعنی پیام از طرف مشاور.\n\n` +
          `تشخیص بده آیا این گفتگو واقعاً مرتبط با کار املاک است (کسی که دنبال خرید ملک است، یا مالک ملکی است که ` +
          `ممکن است بخواهد بفروشد) یا کاملاً شخصی/بی‌ربط است (خانواده، دوستان، کار دیگر، تبلیغات و...). ` +
          `اگر مطمئن نیستید یا سرنخ کافی نیست، is_relevant را false بگذارید — فقط در صورت وجود سرنخ روشن true بزنید.\n\n` +
          `گفتگو:\n"""\n${transcriptLines.join('\n')}\n"""`,
      },
    ],
  });
  if (response.stop_reason === 'refusal') return null;
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) return null;
  try {
    return JSON.parse(textBlock.text);
  } catch {
    return null;
  }
}

function upsertByPhone(existing, phone, buildEntry) {
  const normalized = normalizePhone(phone);
  const byPhone = new Map(existing.map((i) => [normalizePhone(i.phone), i]));
  const prior = byPhone.get(normalized);
  byPhone.set(normalized, buildEntry(prior));
  return Array.from(byPhone.values());
}

function extractText(message) {
  const m = message.message;
  if (!m) return '';
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    ''
  );
}

// ---------- per-contact rolling buffer + debounced analysis ----------

const buffers = new Map(); // jid -> [{ fromMe, text, at }]
const analysisTimers = new Map(); // jid -> Timeout

function scheduleAnalysis(jid, name) {
  if (analysisTimers.has(jid)) clearTimeout(analysisTimers.get(jid));
  analysisTimers.set(
    jid,
    setTimeout(() => {
      analysisTimers.delete(jid);
      runAnalysis(jid, name).catch((err) => console.error('تحلیل مخاطب ناموفق بود:', err.message));
    }, ANALYSIS_DEBOUNCE_MS)
  );
}

async function runAnalysis(jid, name) {
  const buffer = buffers.get(jid) || [];
  if (buffer.length === 0) return;

  const phone = jid.split('@')[0];
  const normalized = normalizePhone(phone);
  const known = loadKnownContacts();
  const match = known.find((c) => normalizePhone(c.phone) === normalized);

  const transcriptLines = buffer.map((m) => `${m.fromMe ? 'من' : name}: ${m.text}`);
  const incoming = buffer.filter((m) => !m.fromMe);
  const lastIncoming = incoming[incoming.length - 1];
  const lastAny = buffer[buffer.length - 1];

  if (match && match.role === 'owner') {
    // مالک‌های ثبت‌شده روی یک ملک نیازی به تحلیل رفتاری ندارند — نادیده گرفته می‌شود
    return;
  }

  if (match && match.role === 'customer') {
    const analysis = await analyzeCustomer(match.name || name, transcriptLines);
    if (!analysis) return;
    const insightsPath = path.join(DATA_REPO_DIR, 'data', 'contact-insights.json');
    let insights = loadJson(insightsPath, []);
    if (!Array.isArray(insights)) insights = [];
    insights = upsertByPhone(insights, phone, () => ({
      phone,
      suggested_potential: analysis.suggested_potential,
      suggested_interested: analysis.suggested_interested,
      note: analysis.note,
      last_message_at: lastAny.at,
      last_message_preview: lastIncoming ? lastIncoming.text.slice(0, 200) : '',
      updated_at: new Date().toISOString(),
    }));
    saveJson(insightsPath, insights);
    console.log(`+ پیشنهاد برای مشتری «${match.name || name}» ثبت شد.`);
    scheduleSync('data/contact-insights.json');
    return;
  }

  // مخاطب ناشناس — اول باید بفهمیم اصلاً مرتبطه یا نه
  const classification = await classifyUnknownContact(name, transcriptLines);
  if (!classification || !classification.is_relevant || classification.role === 'not_relevant') return;

  const leadsPath = path.join(DATA_REPO_DIR, 'data', 'new-leads.json');
  let leads = loadJson(leadsPath, []);
  if (!Array.isArray(leads)) leads = [];
  leads = upsertByPhone(leads, phone, (prior) => ({
    phone,
    name,
    role: classification.role,
    suggested_potential: classification.suggested_potential,
    property_hint: classification.property_hint,
    note: classification.note,
    first_seen_at: (prior && prior.first_seen_at) || lastAny.at,
    updated_at: new Date().toISOString(),
  }));
  saveJson(leadsPath, leads);
  console.log(`+ مخاطب تازه (${classification.role === 'owner' ? 'احتمالا مالک' : 'احتمالا مشتری'}) «${name}» ثبت شد.`);
  scheduleSync('data/new-leads.json');
}

function handleMessage(jid, name, fromMe, text, timestampMs) {
  const buffer = buffers.get(jid) || [];
  buffer.push({ fromMe, text, at: new Date(timestampMs).toISOString() });
  while (buffer.length > MAX_BUFFER_MESSAGES) buffer.shift();
  buffers.set(jid, buffer);
  scheduleAnalysis(jid, name);
}

// ---------- WhatsApp connection ----------

async function startBot() {
  ensureDataRepo();

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    auth: state,
    version,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      console.log('\nبرای اتصال، این QR را با واتساپ اسکن کنید (واتساپ > تنظیمات > دستگاه‌های متصل > اتصال دستگاه):\n');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error instanceof Boom
        ? lastDisconnect.error.output?.statusCode
        : undefined;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log('اتصال قطع شد.', shouldReconnect ? 'در حال تلاش مجدد...' : 'خروج کامل — پوشه auth_info را پاک کنید و دوباره QR بزنید.');
      if (shouldReconnect) setTimeout(startBot, 3000);
    } else if (connection === 'open') {
      console.log('✅ به واتساپ وصل شد. در حال گوش دادن به چت‌ها (به‌جز شماره‌های حذف‌شده)...');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const excluded = loadExcludedNumbers();
    for (const msg of messages) {
      if (!msg.message) continue;
      const jid = msg.key.remoteJid;
      if (!jid || !jid.endsWith('@s.whatsapp.net')) continue; // فقط چت‌های شخصی، نه گروه‌ها

      const phoneFromJid = jid.split('@')[0];
      if (excluded.has(normalizePhone(phoneFromJid))) continue; // شماره‌ای که باید کاملاً نادیده گرفته بشه

      const text = extractText(msg);
      if (!text.trim()) continue;

      const name = msg.pushName || phoneFromJid;
      const timestampMs = (Number(msg.messageTimestamp) || Date.now() / 1000) * 1000;
      try {
        handleMessage(jid, name, !!msg.key.fromMe, text, timestampMs);
      } catch (err) {
        console.error('خطا در پردازش پیام:', err.message);
      }
    }
  });
}

startBot().catch((err) => {
  console.error('خطای غیرمنتظره در راه‌اندازی:', err);
  process.exit(1);
});
