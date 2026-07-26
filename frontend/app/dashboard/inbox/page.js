'use client';

// Live message inbox: the real messages the WhatsApp/Telegram listeners
// extracted, split into a WhatsApp tab and a Telegram tab. Each contact is
// auto-marked (owner/client/unknown) by the AI and can be re-marked by hand
// with the dropdown; a "clients only" filter narrows each tab to buyers.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { useAuth } from '../../../lib/AuthContext';
import { useLanguage } from '../../../lib/LanguageContext';

const STRINGS = {
  fa: {
    title: '📨 صندوق پیام‌ها',
    desc: 'چت‌های زنده‌ای که ربات از واتساپ و تلگرام دریافت کرده — هر پلتفرم در تب خودش.',
    tabWhatsapp: '💬 واتساپ',
    tabTelegram: '✈️ تلگرام',
    all: 'همه',
    clientsOnly: 'فقط مشتری‌ها',
    empty: 'در این صندوق پیامی نیست.',
    emptyClients: 'مشتری‌ای در این تب پیدا نشد.',
    roleLabel: 'دسته:',
    owner: 'مالک',
    client: 'مشتری',
    unknown: 'نامشخص',
    count: (n) => `${n} مخاطب`,
    sync: '🔄 همگام‌سازی تلگرام',
    syncing: 'در حال همگام‌سازی…',
    syncDone: (s) =>
      `همگام‌سازی شد: ${s.chats ?? 0} چت از ${s.dialogs ?? 0} گفتگو · ${s.labeled ?? 0} برچسب‌خورده` +
      (s.failed ? ` · ${s.failed} خطا` : ''),
  },
  en: {
    title: '📨 Inbox',
    desc: 'Live chats the bot received from WhatsApp and Telegram — each platform in its own tab.',
    tabWhatsapp: '💬 WhatsApp',
    tabTelegram: '✈️ Telegram',
    all: 'All',
    clientsOnly: 'Clients only',
    empty: 'No messages in this inbox.',
    emptyClients: 'No clients in this tab.',
    roleLabel: 'Category:',
    owner: 'Owner',
    client: 'Client',
    unknown: 'Unknown',
    count: (n) => `${n} contacts`,
    sync: '🔄 Sync Telegram',
    syncing: 'Syncing…',
    syncDone: (s) =>
      `Synced: ${s.chats ?? 0} chats from ${s.dialogs ?? 0} dialogs · ${s.labeled ?? 0} labeled` +
      (s.failed ? ` · ${s.failed} errors` : ''),
  },
  ar: {
    title: '📨 صندوق الرسائل',
    desc: 'المحادثات الحية التي استقبلها البوت من واتساب وتيليجرام — كل منصة في تبويبها.',
    tabWhatsapp: '💬 واتساب',
    tabTelegram: '✈️ تيليجرام',
    all: 'الكل',
    clientsOnly: 'العملاء فقط',
    empty: 'لا رسائل في هذا الصندوق.',
    emptyClients: 'لا عملاء في هذا التبويب.',
    roleLabel: 'الفئة:',
    owner: 'مالك',
    client: 'عميل',
    unknown: 'غير معروف',
    count: (n) => `${n} جهة اتصال`,
    sync: '🔄 مزامنة تيليجرام',
    syncing: 'جارٍ المزامنة…',
    syncDone: (s) =>
      `تمت المزامنة: ${s.chats ?? 0} محادثة من ${s.dialogs ?? 0} · ${s.labeled ?? 0} موسومة` +
      (s.failed ? ` · ${s.failed} أخطاء` : ''),
  },
};

export default function InboxPage() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const t = STRINGS[lang] || STRINGS.fa;

  const [source, setSource] = useState('telegram'); // 'telegram' | 'whatsapp'
  const [onlyClients, setOnlyClients] = useState(false);
  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setChats(await apiFetch(`/api/chats?source=${source}`, { token }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token, source]);

  useEffect(() => {
    if (token) load();
  }, [token, load]);

  const setRole = async (id, role) => {
    try {
      await apiFetch(`/api/chats/${id}/role`, { method: 'POST', body: { role }, token });
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  // Pull previous Telegram chats through the pipeline, then reload.
  const handleSync = async () => {
    setSyncing(true);
    setSyncMsg('');
    setError('');
    try {
      const res = await apiFetch('/api/telegram/sync', { method: 'POST', body: {}, token });
      setSyncMsg(t.syncDone(res || {}));
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  };

  const visible = useMemo(
    () => (onlyClients ? chats.filter((c) => c.role === 'client') : chats),
    [chats, onlyClients]
  );

  return (
    <>
      <div className="topbar">
        <div>
          <h1>{t.title}</h1>
          <div className="desc">{t.desc}</div>
        </div>
        <div className="actions">
          {source === 'telegram' && (
            <button className="btn accent" onClick={handleSync} disabled={syncing}>
              {syncing ? t.syncing : t.sync}
            </button>
          )}
          <span className="desc tabular">{t.count(visible.length)}</span>
        </div>
      </div>

      <div className="content">
        {/* separate WhatsApp / Telegram inboxes */}
        <div className="seg-tabs">
          <button className={`seg${source === 'whatsapp' ? ' active' : ''}`} onClick={() => setSource('whatsapp')}>
            {t.tabWhatsapp}
          </button>
          <button className={`seg${source === 'telegram' ? ' active' : ''}`} onClick={() => setSource('telegram')}>
            {t.tabTelegram}
          </button>
        </div>

        {/* clients-only filter */}
        <div className="filters">
          <div className={`chip${!onlyClients ? ' active' : ''}`} onClick={() => setOnlyClients(false)}>
            {t.all}
          </div>
          <div className={`chip${onlyClients ? ' active' : ''}`} onClick={() => setOnlyClients(true)}>
            {t.clientsOnly}
          </div>
        </div>

        {error && <div className="form-error">{error}</div>}
        {syncMsg && <div className="form-notice">{syncMsg}</div>}
        {!loading && visible.length === 0 && (
          <div className="empty-note">{onlyClients ? t.emptyClients : t.empty}</div>
        )}

        <div className="card-list">
          {visible.map((chat) => (
            <div className="lead-card" key={chat.id}>
              <div className="who">
                <div className="name">
                  {chat.name || chat.phone || chat.telegram_id}
                  {chat.context === 'group' && <span className="pill muted" style={{ marginInlineStart: 8 }}>👥</span>}
                </div>
                {chat.phone && <div className="meta"><span className="tabular">{chat.phone}</span></div>}
                {chat.last_message && (
                  <div className="meta" style={{ marginTop: 4 }}>«{chat.last_message.slice(0, 140)}»</div>
                )}
                <div className="meta" style={{ marginTop: 6, alignItems: 'center' }}>
                  <span className="pill muted">{t.roleLabel}</span>
                  <select
                    className="role-select"
                    value={chat.role || 'unknown'}
                    onChange={(e) => setRole(chat.id, e.target.value)}
                  >
                    <option value="owner">{t.owner}</option>
                    <option value="client">{t.client}</option>
                    <option value="unknown">{t.unknown}</option>
                  </select>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
