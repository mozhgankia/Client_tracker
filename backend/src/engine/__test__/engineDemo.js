// Offline proof for the Real-Estate AI Engine — no network, no AI key, no DB.
// Simulates real conversations (one contact = several messages over time) and
// prints the engine's rolling classification, confidence, and extracted values.
// Run: node backend/src/engine/__test__/engineDemo.js
'use strict';

const { scoreMessage, updateProfile } = require('../realEstateEngine');

// Each conversation: a chat type + the messages that arrive over time.
const CONVERSATIONS = [
  {
    who: 'سارا (مشتری فارسی)',
    chatType: 'private',
    expect: 'client',
    messages: [
      'سلام وقت بخیر',
      'دنبال یه آپارتمان ۲ خوابه توی مارینا هستم',
      'بودجه‌م حدود ۲.۵ میلیون درهم هست',
    ],
  },
  {
    who: 'Reza (owner, mixed)',
    chatType: 'private',
    expect: 'owner',
    messages: [
      'واحد دارم توی Downtown، متراژ 1200 sqft',
      'برای فروش هست، مالکشم، ۳.۱ million AED',
    ],
  },
  {
    who: 'Ahmed (client, English)',
    chatType: 'private',
    expect: 'client',
    messages: ['Hi, I am looking for a 1BR apartment in JVC', 'my budget is around 900k AED to buy'],
  },
  {
    who: 'مالك عربي',
    chatType: 'private',
    expect: 'owner',
    messages: ['شقة للبيع في الخليج التجاري', 'المالك مباشرة، 2 غرفة'],
  },
  {
    who: 'گروه همکاران A2A',
    chatType: 'group',
    expect: 'colleague',
    messages: [
      'واحد ready در JVC موجوده',
      'کمیسیون ۵۰/۵۰ برای همکاران',
      'A2A only, half commission',
    ],
  },
  {
    who: 'Landlord to rent (EN)',
    chatType: 'private',
    expect: 'owner',
    messages: ['2BR available for rent in Business Bay', 'ready to move, 95k per year'],
  },
  {
    who: 'مشتری اجاره',
    chatType: 'private',
    expect: 'client',
    messages: ['اجاره میخوام، یه استودیو نزدیک مترو', 'تا سقف ۶۰ هزار درهم در سال'],
  },
  {
    who: 'همکار خصوصی',
    chatType: 'private',
    expect: 'colleague',
    messages: ['سلام همکار، مشتری داری برای این واحد؟', 'کراس دیل کنیم، کمیسیون نصف نصف'],
  },
];

const pad = (s, n) => {
  s = String(s);
  // rough visual width (count wide/RTL chars as 1 — good enough for a demo table)
  const w = [...s].length;
  return s + ' '.repeat(Math.max(0, n - w));
};

const ROLE_FA = { client: 'مشتری', owner: 'مالک', colleague: 'همکار', unknown: 'نامشخص' };

console.log('\n=== Real-Estate AI Engine — offline classification demo ===\n');

let correct = 0;
for (const conv of CONVERSATIONS) {
  let profile = {}; // starts empty; grows message by message
  for (const text of conv.messages) {
    const msg = scoreMessage(text, { chatType: conv.chatType });
    const res = updateProfile(profile, msg, {});
    profile = {
      signals: res.signals,
      role: res.role,
      role_source: res.roleSource,
      confidence: res.confidence,
      needs_review: res.needsReview,
      extracted: res.extracted,
    };
  }
  const ok = profile.role === conv.expect;
  if (ok) correct++;
  const x = profile.extracted || {};
  const bits = [
    x.request_type && `req=${x.request_type}`,
    x.region && `region=${x.region}`,
    x.bedrooms != null && `bed=${x.bedrooms}`,
    x.area_sqft && `sqft=${x.area_sqft}`,
    x.price && `price=${x.price.toLocaleString()}`,
    x.property_type && `type=${x.property_type}`,
  ].filter(Boolean).join(', ');

  console.log(
    `${ok ? '✅' : '❌'}  ${pad(conv.who, 24)}  → ${pad(ROLE_FA[profile.role], 8)} ` +
      `(${String(profile.confidence).padStart(3)}%${profile.needs_review ? ' · needs review' : ''})`
  );
  console.log(`     signals: client=${profile.signals.client} owner=${profile.signals.owner} colleague=${profile.signals.colleague}`);
  if (bits) console.log(`     extracted: ${bits}`);
  console.log('');
}

console.log(`نتیجه: ${correct}/${CONVERSATIONS.length} مکالمه درست دسته‌بندی شد.\n`);
process.exit(correct === CONVERSATIONS.length ? 0 : 1);
