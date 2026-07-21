'use client';

import { useState } from 'react';
import { apiPostText } from '../../../lib/api';
import { useAuth } from '../../../lib/AuthContext';
import { useLanguage } from '../../../lib/LanguageContext';

const STRINGS = {
  fa: {
    title: '📥 ورود چت‌های قدیمی واتساپ',
    desc: 'فایل اکسپورت یک چت یا گروه واتساپ (.txt) را آپلود کنید تا هوش مصنوعی همه‌ی پیام‌های قدیمی را بررسی و لیدهای مشتری/مالک را بسازد. لیدها در تب «لیدهای تازه» برای تأییدِ شما ظاهر می‌شوند.',
    how: 'چطور فایل اکسپورت بسازم؟',
    howSteps: [
      'در واتساپ چت یا گروه موردنظر را باز کنید.',
      'روی نام چت (بالای صفحه) بزنید → «Export Chat / خروجی چت».',
      'گزینه‌ی «Without Media / بدون رسانه» را انتخاب کنید (سریع‌تر است).',
      'فایل .txt به‌دست‌آمده را همین‌جا آپلود کنید.',
    ],
    pick: 'انتخاب فایل .txt',
    upload: 'شروع پردازش',
    uploading: 'در حال پردازش با هوش مصنوعی… (بسته به حجم چت ممکن است چند دقیقه طول بکشد)',
    resultTitle: 'نتیجه‌ی پردازش',
    rTotal: 'کل پیام‌های چت',
    rCandidates: 'پیام‌های مرتبط با املاک',
    rSaved: 'لید ساخته‌شده',
    rIrrelevant: 'نامرتبط (رد شد)',
    rFailed: 'خطا در پردازش',
    truncated: '⚠️ تعداد پیام‌های مرتبط زیاد بود؛ فقط بخشی پردازش شد. برای بقیه، چت را به فایل‌های کوچک‌تر تقسیم کنید یا دوباره آپلود کنید.',
    goLeads: 'رفتن به تب لیدهای تازه ←',
    noFile: 'اول یک فایل .txt انتخاب کنید.',
  },
  en: {
    title: '📥 Import old WhatsApp chats',
    desc: 'Upload an exported WhatsApp chat or group (.txt). The AI reviews every old message and creates client/owner leads. They appear in the “New leads” tab for your approval.',
    how: 'How do I export a chat?',
    howSteps: [
      'Open the chat or group in WhatsApp.',
      'Tap the chat name (top) → “Export Chat”.',
      'Choose “Without Media” (it’s faster).',
      'Upload the resulting .txt file here.',
    ],
    pick: 'Choose .txt file',
    upload: 'Start processing',
    uploading: 'Processing with AI… (may take a few minutes depending on chat size)',
    resultTitle: 'Import result',
    rTotal: 'Total messages',
    rCandidates: 'Real-estate messages',
    rSaved: 'Leads created',
    rIrrelevant: 'Irrelevant (skipped)',
    rFailed: 'Processing errors',
    truncated: '⚠️ Too many relevant messages; only part was processed. Split the chat into smaller files, or upload again for the rest.',
    goLeads: 'Go to New leads tab →',
    noFile: 'Pick a .txt file first.',
  },
  ar: {
    title: '📥 استيراد محادثات واتساب القديمة',
    desc: 'حمّل ملف تصدير محادثة أو مجموعة واتساب (.txt). يراجع الذكاء الاصطناعي كل رسالة قديمة وينشئ عملاء محتملين (عميل/مالك). تظهر في تبويب «عملاء محتملون جدد» لموافقتك.',
    how: 'كيف أصدّر محادثة؟',
    howSteps: [
      'افتح المحادثة أو المجموعة في واتساب.',
      'اضغط على اسم المحادثة (أعلى) ← «تصدير المحادثة».',
      'اختر «بدون وسائط» (أسرع).',
      'حمّل ملف .txt الناتج هنا.',
    ],
    pick: 'اختر ملف .txt',
    upload: 'ابدأ المعالجة',
    uploading: 'جارٍ المعالجة بالذكاء الاصطناعي… (قد يستغرق بضع دقائق حسب حجم المحادثة)',
    resultTitle: 'نتيجة الاستيراد',
    rTotal: 'إجمالي الرسائل',
    rCandidates: 'رسائل متعلقة بالعقارات',
    rSaved: 'عملاء محتملون تم إنشاؤهم',
    rIrrelevant: 'غير متعلق (تم تخطيه)',
    rFailed: 'أخطاء المعالجة',
    truncated: '⚠️ عدد الرسائل المتعلقة كبير؛ تمت معالجة جزء فقط. قسّم المحادثة إلى ملفات أصغر أو أعد الرفع للبقية.',
    goLeads: 'اذهب إلى تبويب العملاء المحتملين ←',
    noFile: 'اختر ملف .txt أولاً.',
  },
};

export default function ImportPage() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const t = STRINGS[lang] || STRINGS.fa;

  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const handleUpload = async () => {
    setError('');
    setResult(null);
    if (!file) {
      setError(t.noFile);
      return;
    }
    setBusy(true);
    try {
      const text = await file.text();
      const label = encodeURIComponent(file.name.replace(/\.txt$/i, ''));
      const stats = await apiPostText(`/api/import/whatsapp?label=${label}`, text, { token });
      setResult(stats);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="topbar">
        <div>
          <h1>{t.title}</h1>
          <div className="desc">{t.desc}</div>
        </div>
      </div>

      <div className="content">
        {error && <div className="form-error">{error}</div>}

        <div className="card" style={{ padding: 20, marginBottom: 16 }}>
          <strong>{t.how}</strong>
          <ol style={{ margin: '10px 0 0', paddingInlineStart: 20, lineHeight: 1.9 }}>
            {t.howSteps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </div>

        <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            type="file"
            accept=".txt,text/plain"
            onChange={(e) => {
              setFile(e.target.files?.[0] || null);
              setResult(null);
              setError('');
            }}
          />
          <button className="btn-primary" onClick={handleUpload} disabled={busy} style={{ alignSelf: 'flex-start' }}>
            {busy ? t.uploading : t.upload}
          </button>
        </div>

        {result && (
          <div className="card" style={{ padding: 20, marginTop: 16 }}>
            <h2 style={{ marginTop: 0 }}>{t.resultTitle}</h2>
            <div className="import-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 12 }}>
              <Stat label={t.rTotal} value={result.totalMessages} />
              <Stat label={t.rCandidates} value={result.candidates} />
              <Stat label={t.rSaved} value={result.leadsSaved} accent />
              <Stat label={t.rIrrelevant} value={result.irrelevant} />
              {result.failed > 0 && <Stat label={t.rFailed} value={result.failed} />}
            </div>
            {result.truncated && (
              <div className="form-error" style={{ marginTop: 12 }}>
                {t.truncated}
              </div>
            )}
            <a href="/dashboard/leads" className="btn" style={{ marginTop: 14, display: 'inline-block' }}>
              {t.goLeads}
            </a>
          </div>
        )}
      </div>
    </>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div
      style={{
        border: '1px solid var(--line, #e5e7eb)',
        borderRadius: 12,
        padding: '12px 14px',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 24, fontWeight: 700, color: accent ? 'var(--accent-ink)' : 'inherit' }} className="tabular">
        {Number(value ?? 0).toLocaleString()}
      </div>
      <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>{label}</div>
    </div>
  );
}
