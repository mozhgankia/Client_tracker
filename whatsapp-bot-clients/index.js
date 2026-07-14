// Persistent WhatsApp listener on your MAIN number: watches 1-1 chats with
// contacts already registered as customers/owners in data/contacts.json
// (exported from the tracker web app), and pushes potential/interest
// suggestions to data/contact-insights.json. It never analyzes or stores
// messages from numbers that aren't on the watchlist.
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

const INSIGHT_SCHEMA = {
  type: 'object',
  properties: {
    suggested_potential: { type: 'string', enum: ['high', 'medium', 'low'] },
    suggested_interested: { type: 'string', enum: ['yes', 'no', 'unknown'] },
    note: { type: 'string', description: 'خلاصه یک جمله‌ای از وضعیت فعلی این مخاطب بر اساس پیام‌های اخیر' },
  },
  required: ['suggested_potential', 'suggested_interested', 'note'],
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

function loadWatchlist() {
  const contacts = loadJson(path.join(DATA_REPO_DIR, 'data', 'contacts.json'), []);
  return Array.isArray(contacts) ? contacts : [];
}

let pendingChanges = false;
let syncTimer = null;

function scheduleSync() {
  pendingChanges = true;
  if (syncTimer) return;
  syncTimer = setTimeout(() => {
    syncTimer = null;
    syncToRepo().catch((err) => console.error('sync failed:', err.message));
  }, SYNC_DEBOUNCE_MS);
}

async function syncToRepo() {
  if (!pendingChanges) return;
  pendingChanges = false;

  try {
    git(['pull', '--rebase', 'origin', GIT_BRANCH]);
  } catch (err) {
    console.warn('git pull قبل از push ناموفق بود:', err.message);
  }

  git(['add', 'data/contact-insights.json']);
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

async function analyzeContact(role, name, transcriptLines) {
  const roleLabel = role === 'owner' ? 'مالک ملک' : 'مشتری خریدار';
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    output_config: { format: { type: 'json_schema', schema: INSIGHT_SCHEMA } },
    messages: [
      {
        role: 'user',
        content:
          `شما دستیار یک مشاور املاک هستید. متن زیر چند پیام اخیر واتساپ بین مشاور و «${name}» ` +
          `(${roleLabel}) است. «من:» یعنی پیام از طرف مشاور، بقیه خطوط پیام‌های خود ${roleLabel} است.\n\n` +
          `بر اساس این گفتگو:\n` +
          (role === 'owner'
            ? '- suggested_potential: احتمال اینکه این مالک واقعاً ملکش را از طریق مشاور بفروشد (زیاد/متوسط/کم)\n'
            : '- suggested_potential: احتمال خرید این مشتری (زیاد/متوسط/کم)\n') +
          `- suggested_interested: آیا این مخاطب معمولاً به پیام‌ها جواب می‌دهد؟\n` +
          `- note: یک جمله خلاصه از وضعیت فعلی.\n\n` +
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

function upsertInsight(existing, phone, role, analysis, lastMessageAt, lastMessagePreview, firstSeenAt) {
  const normalized = normalizePhone(phone);
  const byPhone = new Map(existing.map((i) => [normalizePhone(i.phone), i]));
  const prior = byPhone.get(normalized);
  byPhone.set(normalized, {
    phone,
    role,
    suggested_potential: analysis.suggested_potential,
    suggested_interested: analysis.suggested_interested,
    note: analysis.note,
    last_message_at: lastMessageAt,
    last_message_preview: lastMessagePreview,
    first_seen_at: (prior && prior.first_seen_at) || firstSeenAt,
    updated_at: new Date().toISOString(),
  });
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

function scheduleAnalysis(jid, contact) {
  if (analysisTimers.has(jid)) clearTimeout(analysisTimers.get(jid));
  analysisTimers.set(
    jid,
    setTimeout(() => {
      analysisTimers.delete(jid);
      runAnalysis(jid, contact).catch((err) => console.error('تحلیل مخاطب ناموفق بود:', err.message));
    }, ANALYSIS_DEBOUNCE_MS)
  );
}

async function runAnalysis(jid, contact) {
  const buffer = buffers.get(jid) || [];
  if (buffer.length === 0) return;

  const transcriptLines = buffer.map((m) => `${m.fromMe ? 'من' : contact.name}: ${m.text}`);
  const incoming = buffer.filter((m) => !m.fromMe);
  const lastIncoming = incoming[incoming.length - 1];
  const lastAny = buffer[buffer.length - 1];

  const analysis = await analyzeContact(contact.role, contact.name, transcriptLines);
  if (!analysis) return;

  const insightsPath = path.join(DATA_REPO_DIR, 'data', 'contact-insights.json');
  let insights = loadJson(insightsPath, []);
  if (!Array.isArray(insights)) insights = [];

  insights = upsertInsight(
    insights,
    contact.phone,
    contact.role,
    analysis,
    lastAny.at,
    lastIncoming ? lastIncoming.text.slice(0, 200) : '',
    buffer[0].at
  );
  saveJson(insightsPath, insights);
  console.log(`+ پیشنهاد برای «${contact.name}» (${contact.role === 'owner' ? 'مالک' : 'مشتری'}) ثبت شد.`);
  scheduleSync();
}

function handleWatchedMessage(jid, contact, fromMe, text, timestampMs) {
  const buffer = buffers.get(jid) || [];
  buffer.push({ fromMe, text, at: new Date(timestampMs).toISOString() });
  while (buffer.length > MAX_BUFFER_MESSAGES) buffer.shift();
  buffers.set(jid, buffer);
  scheduleAnalysis(jid, contact);
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
      console.log('✅ به واتساپ وصل شد. در حال گوش دادن به چت‌های شماره‌های ثبت‌شده...');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (!msg.message) continue;
      const jid = msg.key.remoteJid;
      if (!jid || !jid.endsWith('@s.whatsapp.net')) continue; // فقط چت‌های شخصی، نه گروه‌ها

      const text = extractText(msg);
      if (!text.trim()) continue;

      const phoneFromJid = jid.split('@')[0];
      const watchlist = loadWatchlist();
      const contact = watchlist.find((c) => normalizePhone(c.phone) === normalizePhone(phoneFromJid));
      if (!contact) continue; // فقط شماره‌های ثبت‌شده در data/contacts.json بررسی می‌شن

      const timestampMs = (Number(msg.messageTimestamp) || Date.now() / 1000) * 1000;
      try {
        handleWatchedMessage(jid, contact, !!msg.key.fromMe, text, timestampMs);
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
