// Generates a one-off market price analysis report for a single property.
// Reads property details from environment variables (set by the GitHub
// Actions workflow_dispatch inputs), asks Claude (with web search) to
// research the going market price for that area/property type and assess
// this property against it, then writes a printable/exportable HTML page
// under reports/ and registers it in reports/index.json.
'use strict';

const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const ROOT = path.join(__dirname, '..');
const REPORTS_DIR = path.join(ROOT, 'reports');
const INDEX_PATH = path.join(REPORTS_DIR, 'index.json');
const MODEL = 'claude-opus-4-8';

const title = process.env.PROPERTY_TITLE || '';
const location = process.env.PROPERTY_LOCATION || '';
const price = process.env.PROPERTY_PRICE || '';
const area = process.env.PROPERTY_AREA || '';
const description = process.env.PROPERTY_DESCRIPTION || '';

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY تنظیم نشده است.');
  process.exit(1);
}
if (!title || !location || !price) {
  console.error('عنوان، موقعیت و قیمت ملک باید وارد شده باشند.');
  process.exit(1);
}

const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    market_summary: { type: 'string', description: 'خلاصه‌ای از وضعیت قیمت مارکت در این منطقه و برای این نوع ملک' },
    estimated_market_price: { type: 'string', description: 'برآورد محدوده قیمت متعارف مارکت برای ملکی مشابه در این منطقه' },
    assessment: { type: 'string', enum: ['underpriced', 'fair', 'overpriced', 'unknown'] },
    assessment_explanation: { type: 'string', description: 'توضیح اینکه چرا این ارزیابی داده شده' },
    comparable_examples: { type: 'array', items: { type: 'string' }, description: 'چند نمونه ملک مشابه که در جست‌وجو پیدا شده (در صورت وجود)' },
    recommendation: { type: 'string', description: 'یک پیشنهاد عملی برای مشاور املاک' },
  },
  required: ['market_summary', 'estimated_market_price', 'assessment', 'assessment_explanation', 'comparable_examples', 'recommendation'],
  additionalProperties: false,
};

const ASSESSMENT_FA = {
  underpriced: 'پایین‌تر از مارکت',
  fair: 'منصفانه / هم‌سطح مارکت',
  overpriced: 'بالاتر از مارکت',
  unknown: 'نامشخص',
};

function slugify(text) {
  return String(text || 'property')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'property';
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function analyze() {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    tools: [{ type: 'web_search_20260209', name: 'web_search' }],
    output_config: { format: { type: 'json_schema', schema: ANALYSIS_SCHEMA } },
    messages: [
      {
        role: 'user',
        content:
          `شما یک تحلیل‌گر بازار املاک هستید. لطفاً با جست‌وجوی وب، قیمت متعارف مارکت را برای ملک زیر بررسی و تحلیل کنید:\n\n` +
          `عنوان: ${title}\n` +
          `موقعیت: ${location}\n` +
          (area ? `متراژ: ${area}\n` : '') +
          `قیمت درخواستی فعلی: ${price}\n` +
          (description ? `توضیحات: ${description}\n` : '') +
          `\nقیمت رایج بازار برای ملک‌های مشابه در همین منطقه را جست‌وجو کنید و این ملک را با آن مقایسه کنید.`,
      },
    ],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('Claude از تحلیل این درخواست خودداری کرد.');
  }
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('پاسخی از Claude دریافت نشد.');
  return JSON.parse(textBlock.text);
}

function buildHtml(analysis) {
  const generatedAt = new Date().toLocaleDateString('fa-IR', { year: 'numeric', month: 'long', day: 'numeric' });
  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>گزارش تحلیل قیمت — ${escapeHtml(title)}</title>
<style>
  body { font-family: Tahoma, Arial, sans-serif; max-width: 760px; margin: 40px auto; padding: 0 20px; color: #1f2430; line-height: 1.9; }
  h1 { font-size: 1.4rem; margin-bottom: 4px; }
  .meta { color: #6b7280; font-size: .9rem; margin-bottom: 24px; }
  .section { background: #f5f6fa; border-radius: 10px; padding: 16px 18px; margin-bottom: 16px; }
  .section h2 { font-size: 1rem; margin: 0 0 8px; }
  .badge { display: inline-block; padding: 4px 12px; border-radius: 999px; font-size: .85rem; font-weight: bold; }
  .badge.underpriced { background: #16a34a; color: #fff; }
  .badge.fair { background: #2563eb; color: #fff; }
  .badge.overpriced { background: #dc2626; color: #fff; }
  .badge.unknown { background: #6b7280; color: #fff; }
  ul { margin: 8px 0; padding-inline-start: 20px; }
  @media print { body { margin: 0; padding: 10px; } }
</style>
</head>
<body>
  <h1>گزارش تحلیل قیمت: ${escapeHtml(title)}</h1>
  <div class="meta">تاریخ تولید: ${generatedAt} · موقعیت: ${escapeHtml(location)} · قیمت درخواستی: ${escapeHtml(price)}</div>

  <div class="section">
    <h2>وضعیت این ملک نسبت به مارکت</h2>
    <span class="badge ${escapeHtml(analysis.assessment)}">${escapeHtml(ASSESSMENT_FA[analysis.assessment] || analysis.assessment)}</span>
    <p>${escapeHtml(analysis.assessment_explanation)}</p>
  </div>

  <div class="section">
    <h2>خلاصه قیمت مارکت منطقه</h2>
    <p>${escapeHtml(analysis.market_summary)}</p>
    <p><strong>برآورد محدوده قیمت مارکت:</strong> ${escapeHtml(analysis.estimated_market_price)}</p>
  </div>

  ${analysis.comparable_examples && analysis.comparable_examples.length
    ? `<div class="section"><h2>نمونه‌های مشابه پیدا شده</h2><ul>${analysis.comparable_examples.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul></div>`
    : ''}

  <div class="section">
    <h2>پیشنهاد</h2>
    <p>${escapeHtml(analysis.recommendation)}</p>
  </div>

  <p class="meta">این گزارش با کمک هوش مصنوعی و جست‌وجوی وب تولید شده و ممکن است کامل یا صد‌درصد دقیق نباشد — پیش از استفاده در مذاکره، بررسی کنید.</p>
</body>
</html>
`;
}

async function main() {
  const analysis = await analyze();
  const html = buildHtml(analysis);

  const slug = `${slugify(title)}-${Date.now()}`;
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const filePath = path.join(REPORTS_DIR, `${slug}.html`);
  fs.writeFileSync(filePath, html, 'utf8');

  let index = [];
  try {
    index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
    if (!Array.isArray(index)) index = [];
  } catch {
    index = [];
  }
  index.push({
    slug,
    title,
    location,
    price,
    path: `reports/${slug}.html`,
    generatedAt: new Date().toISOString(),
  });
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2) + '\n', 'utf8');

  console.log(`گزارش ساخته شد: reports/${slug}.html`);
}

main().catch((err) => {
  console.error('خطا در ساخت گزارش:', err.message);
  process.exit(1);
});
