'use client';

import { useAuth } from '../../../lib/AuthContext';
import { useLanguage } from '../../../lib/LanguageContext';
import WhatsAppConnection from '../../../components/WhatsAppConnection';
import TelegramConnection from '../../../components/TelegramConnection';

const STRINGS = {
  fa: { title: 'اتصالات', desc: 'واتساپ و تلگرام خود را برای شنود خودکار مشتری‌ها و ملک‌ها وصل کنید.' },
  en: { title: 'Connections', desc: 'Connect WhatsApp and Telegram for automatic client/property monitoring.' },
  ar: { title: 'الاتصالات', desc: 'اربط واتساب وتيليجرام لمراقبة العملاء والعقارات تلقائيًا.' },
};

export default function ConnectionsPage() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const t = STRINGS[lang] || STRINGS.fa;

  return (
    <>
      <div className="topbar">
        <div>
          <h1>{t.title}</h1>
          <div className="desc">{t.desc}</div>
        </div>
      </div>
      <div className="content" style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <WhatsAppConnection authToken={token} lang={lang} />
        <TelegramConnection authToken={token} lang={lang} />
      </div>
    </>
  );
}
