// Persistent WhatsApp listener: reads project-launch news from developer
// group chats and pushes structured updates to the same data/projects.json
// file used by the daily website monitor + the tracker web app.
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
const GIT_USER_NAME = process.env.GIT_USER_NAME || 'whatsapp-monitor-bot';
const GIT_USER_EMAIL = process.env.GIT_USER_EMAIL || 'bot@localhost';
const SYNC_DEBOUNCE_MS = Number(process.env.SYNC_DEBOUNCE_MS || 30000);
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

const ITEM_SCHEMA = {
  type: 'object',
  properties: {
    has_news: {
      type: 'boolean',
      description: 'آیا این پیام شامل خبر یا تغییر واقعی و قابل توجه درباره پروژه‌های ساختمانی است؟',
    },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          project_name: { type: 'string', description: 'نام پروژه یا ملک' },
          type: { type: 'string', enum: ['residential', 'commercial', 'mixed', 'unknown'] },
          status: { type: 'string', description: 'وضعیت فعلی پروژه (مثلا: پیش‌فروش آغاز شد، تحویل نزدیک، تکمیل ظرفیت)' },
          location: { type: 'string', description: 'منطقه یا آدرس پروژه، اگر ذکر شده' },
          price_range: { type: 'string', description: 'محدوده قیمت، اگر ذکر شده' },
          note: { type: 'string', description: 'خلاصه یک یا دو جمله‌ای از خبر برای سازنده' },
          event_type: {
            type: 'string',
            enum: ['launch', 'price_change', 'delivery_update', 'general_news', 'other'],
          },
        },
        required: ['project_name', 'type', 'status', 'location', 'price_range', 'note', 'event_type'],
        additionalProperties: false,
      },
    },
  },
  required: ['has_news', 'items'],
  additionalProperties: false,
};

// ---------- git-backed data store ----------

function git(args, opts = {}) {
  return execFileSync('git', args, {
    cwd: DATA_REPO_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    ...opts,
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

function loadDevelopers() {
  const config = loadJson(path.join(DATA_REPO_DIR, 'config', 'developers.json'), { developers: [] });
  return Array.isArray(config.developers) ? config.developers : [];
}

function upsertProject(existingProjects, developerName, priority, item, sourceUrl) {
  const key = `${developerName}::${item.project_name}`;
  const byKey = new Map(existingProjects.map((p) => [`${p.developer_name}::${p.project_name}`, p]));
  byKey.set(key, {
    developer_name: developerName,
    project_name: item.project_name,
    type: item.type,
    status: item.status,
    location: item.location,
    price_range: item.price_range,
    note: item.note,
    event_type: item.event_type,
    source_url: sourceUrl,
    detected_at: new Date().toISOString(),
    priority,
  });
  return Array.from(byKey.values());
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

  git(['add', 'data/projects.json']);
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

  git(['commit', '-m', 'chore: update from WhatsApp group monitor [automated]']);
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

async function analyzeMessage(developerLabel, text) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    output_config: { format: { type: 'json_schema', schema: ITEM_SCHEMA } },
    messages: [
      {
        role: 'user',
        content:
          `شما دستیار یک مشاور املاک هستید. متن زیر یک پیام تازه در گروه واتساپ سازنده «${developerLabel}» است.\n\n` +
          `بررسی کن که آیا این پیام شامل خبر واقعی و مهم درباره پروژه‌های ساختمانی این سازنده هست ` +
          `(مثل: لانچ پروژه جدید، تغییر قیمت، تغییر وضعیت پیش‌فروش/تحویل) یا فقط گفتگوی عمومی/بی‌ربط است. ` +
          `اگر خبر واقعی پیدا کردی، هر پروژه/خبر را جداگانه در items استخراج کن. اگر خبر مهمی نبود، has_news را ` +
          `false و items را آرایه خالی بگذار.\n\n` +
          `متن پیام:\n"""\n${text}\n"""`,
      },
    ],
  });

  if (response.stop_reason === 'refusal') return { has_news: false, items: [] };
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) return { has_news: false, items: [] };
  try {
    return JSON.parse(textBlock.text);
  } catch {
    return { has_news: false, items: [] };
  }
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

const seenGroups = new Set();
async function announceUnknownGroup(sock, jid) {
  if (seenGroups.has(jid)) return;
  seenGroups.add(jid);
  try {
    const meta = await sock.groupMetadata(jid);
    console.log(`ℹ️  پیام از گروه ناشناس دریافت شد — برای پیگیری با priority درست، این را به config/developers.json اضافه کنید:`);
    console.log(`    نام گروه: ${meta.subject}`);
    console.log(`    whatsapp_group_id: ${jid}`);
  } catch {
    console.log(`ℹ️  پیام از گروه ناشناس با شناسه ${jid} دریافت شد.`);
  }
}

async function handleGroupMessage(sock, jid, msg) {
  const text = extractText(msg);
  if (!text.trim()) return;

  const developers = loadDevelopers();
  const developer = developers.find((d) => d.whatsapp_group_id === jid);

  let developerName;
  let priority;
  if (developer) {
    developerName = developer.name;
    priority = typeof developer.priority === 'number' ? developer.priority : 999;
  } else {
    await announceUnknownGroup(sock, jid);
    try {
      developerName = (await sock.groupMetadata(jid)).subject;
    } catch {
      developerName = jid;
    }
    priority = 999;
  }

  let analysis;
  try {
    analysis = await analyzeMessage(developerName, text);
  } catch (err) {
    console.warn('تحلیل با Claude ناموفق بود:', err.message);
    return;
  }

  if (!analysis.has_news || analysis.items.length === 0) return;

  const projectsPath = path.join(DATA_REPO_DIR, 'data', 'projects.json');
  let projectsData = loadJson(projectsPath, []);
  if (!Array.isArray(projectsData)) projectsData = [];

  for (const item of analysis.items) {
    projectsData = upsertProject(projectsData, developerName, priority, item, `whatsapp:${jid}`);
  }
  saveJson(projectsPath, projectsData);
  console.log(`+ ${analysis.items.length} خبر از گروه «${developerName}» ثبت شد.`);
  scheduleSync();
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
      console.log('✅ به واتساپ وصل شد. در حال گوش دادن به گروه‌ها...');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;
      const jid = msg.key.remoteJid;
      if (!jid || !jid.endsWith('@g.us')) continue;
      try {
        await handleGroupMessage(sock, jid, msg);
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
