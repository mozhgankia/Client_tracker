// Monitors developer news pages, and when content changed, asks Claude to
// pull out structured project/news items into data/projects.json.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Anthropic = require('@anthropic-ai/sdk');

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config', 'developers.json');
const PROJECTS_PATH = path.join(ROOT, 'data', 'projects.json');
const STATE_PATH = path.join(ROOT, 'data', '.state', 'site-hashes.json');

const FETCH_TIMEOUT_MS = 20000;
const MAX_TEXT_CHARS = 12000;
const MODEL = 'claude-opus-4-8';

const ITEM_SCHEMA = {
  type: 'object',
  properties: {
    has_news: {
      type: 'boolean',
      description: 'آیا این صفحه شامل خبر یا تغییر واقعی و قابل توجه درباره پروژه‌های ساختمانی است؟',
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

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (client-tracker-monitor)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    return htmlToText(html).slice(0, MAX_TEXT_CHARS);
  } finally {
    clearTimeout(timer);
  }
}

function hashText(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

async function analyzeWithClaude(client, developer, text) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    output_config: { format: { type: 'json_schema', schema: ITEM_SCHEMA } },
    messages: [
      {
        role: 'user',
        content:
          `شما دستیار یک مشاور املاک هستید. متن زیر، محتوای فعلی صفحه خبر/سایت سازنده «${developer.name}» است ` +
          `(آدرس: ${developer.news_page || developer.website}).\n\n` +
          `این متن نسبت به بار قبلی که بررسی شده تغییر کرده. بررسی کن که آیا این تغییر شامل خبر واقعی و مهم درباره ` +
          `پروژه‌های ساختمانی این سازنده هست (مثل: لانچ پروژه جدید، تغییر قیمت، تغییر وضعیت پیش‌فروش/تحویل، اخبار مهم) ` +
          `یا فقط تغییرات جزئی/بی‌ربط سایت (مثل تغییر تاریخ، منوی ناوبری، شمارنده بازدید). ` +
          `اگر خبر واقعی پیدا کردی، هر پروژه/خبر را به‌صورت جداگانه در items استخراج کن. اگر خبر مهمی نبود، has_news را false و items را آرایه خالی بگذار.\n\n` +
          `متن صفحه:\n"""\n${text}\n"""`,
      },
    ],
  });

  if (response.stop_reason === 'refusal') {
    console.warn(`  ! Claude refused to analyze ${developer.name}`);
    return { has_news: false, items: [] };
  }

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) return { has_news: false, items: [] };
  try {
    return JSON.parse(textBlock.text);
  } catch {
    console.warn(`  ! Could not parse Claude output for ${developer.name}`);
    return { has_news: false, items: [] };
  }
}

function upsertProjects(existingProjects, developer, analysis, sourceUrl) {
  const nowIso = new Date().toISOString();
  const byKey = new Map(
    existingProjects.map((p) => [`${p.developer_name}::${p.project_name}`, p])
  );

  for (const item of analysis.items) {
    const key = `${developer.name}::${item.project_name}`;
    byKey.set(key, {
      developer_name: developer.name,
      project_name: item.project_name,
      type: item.type,
      status: item.status,
      location: item.location,
      price_range: item.price_range,
      note: item.note,
      event_type: item.event_type,
      source_url: sourceUrl,
      detected_at: nowIso,
      priority: developer.priority,
    });
  }

  return Array.from(byKey.values());
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY تنظیم نشده است. اسکریپت متوقف شد.');
    process.exit(1);
  }

  const config = loadJson(CONFIG_PATH, null);
  if (!config || !Array.isArray(config.developers)) {
    console.error(`فایل ${CONFIG_PATH} پیدا نشد یا معتبر نیست.`);
    process.exit(1);
  }

  const client = new Anthropic();
  let projectsData = loadJson(PROJECTS_PATH, []);
  if (!Array.isArray(projectsData)) projectsData = [];
  const state = loadJson(STATE_PATH, {});

  let checked = 0;
  let changed = 0;
  let errored = 0;

  for (const developer of config.developers) {
    if (developer.active === false) continue;
    const url = developer.news_page || developer.website;
    if (!url) continue;

    checked += 1;
    console.log(`Checking ${developer.name} (${url})...`);

    let text;
    try {
      text = await fetchText(url);
    } catch (err) {
      errored += 1;
      console.warn(`  ! Fetch failed: ${err.message}`);
      continue;
    }

    const hash = hashText(text);
    const previous = state[developer.id];

    if (previous && previous.hash === hash) {
      console.log('  = no change');
      continue;
    }

    changed += 1;
    console.log('  * content changed, analyzing with Claude...');

    let analysis;
    try {
      analysis = await analyzeWithClaude(client, developer, text);
    } catch (err) {
      errored += 1;
      console.warn(`  ! Claude analysis failed: ${err.message}`);
      continue;
    }

    if (analysis.has_news && analysis.items.length > 0) {
      projectsData = upsertProjects(projectsData, developer, analysis, url);
      console.log(`  + ${analysis.items.length} item(s) updated`);
    } else {
      console.log('  = change detected but no notable news');
    }

    state[developer.id] = { hash, checked_at: new Date().toISOString(), url };
  }

  saveJson(PROJECTS_PATH, projectsData);
  saveJson(STATE_PATH, state);

  console.log(`Done. checked=${checked} changed=${changed} errored=${errored}`);
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
