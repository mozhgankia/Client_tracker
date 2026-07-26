'use client';

// Live message inbox — mirrors the account's Telegram/WhatsApp chat list like
// Web Telegram / WhatsApp: one clean row per conversation (avatar, name, last
// message preview, time, unread badge, chat-type icon). No login codes, no
// service chats. Each chat can be marked مشتری/مالک/همکار/نامشخص by hand, and a
// "clients only" filter narrows the list to buyers.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { useAuth } from '../../../lib/AuthContext';
import { useLanguage } from '../../../lib/LanguageContext';

const STRINGS = {
  fa: {
    title: '📨 صندوق پیام‌ها',
    desc: 'همه‌ی چت‌های تلگرام و واتساپ شما، درست مثل نسخه‌ی وب — بدون کد ورود یا پیام سیستمی.',
    tabWhatsapp: '💬 واتساپ',
    tabTelegram: '✈️ تلگرام',
    all: 'همه',
    clientsOnly: 'فقط مشتری‌ها',
    empty: 'هنوز چتی اینجا نیست. در حال همگام‌سازی…',
    emptyClients: 'مخاطبی در این پوشه پیدا نشد.',
    owner: 'مالک',
    client: 'مشتری',
    colleague: 'همکار',
    unknown: 'نامشخص',
    review: 'نیازمند بازبینی',
    reviewTag: 'بازبینی',
    reqBuy: 'خرید',
    reqSell: 'فروش',
    reqRent: 'اجاره',
    reqMortgage: 'وام',
    count: (n) => `${n} گفتگو`,
    sync: '🔄 همگام‌سازی تلگرام',
    syncing: 'در حال همگام‌سازی…',
    autoSync: '⏳ سینک خودکار با تلگرام…',
    typePrivate: 'خصوصی',
    typeGroup: 'گروه',
    typeChannel: 'کانال',
    syncDone: (s) =>
      `همگام‌سازی شد: ${s.chats ?? 0} چت از ${s.dialogs ?? 0} گفتگو` +
      (s.skipped ? ` · ${s.skipped} نادیده` : '') +
      (s.failed ? ` · ${s.failed} خطا` : ''),
  },
  en: {
    title: '📨 Inbox',
    desc: 'All your Telegram & WhatsApp chats, just like the web app — no login codes, no system messages.',
    tabWhatsapp: '💬 WhatsApp',
    tabTelegram: '✈️ Telegram',
    all: 'All',
    clientsOnly: 'Clients only',
    empty: 'No chats here yet. Syncing…',
    emptyClients: 'No contacts in this folder.',
    owner: 'Owner',
    client: 'Client',
    colleague: 'Colleague',
    unknown: 'Unknown',
    review: 'Needs review',
    reviewTag: 'review',
    reqBuy: 'buy',
    reqSell: 'sell',
    reqRent: 'rent',
    reqMortgage: 'mortgage',
    count: (n) => `${n} conversations`,
    sync: '🔄 Sync Telegram',
    syncing: 'Syncing…',
    autoSync: '⏳ Auto-syncing Telegram…',
    typePrivate: 'Private',
    typeGroup: 'Group',
    typeChannel: 'Channel',
    syncDone: (s) =>
      `Synced: ${s.chats ?? 0} chats from ${s.dialogs ?? 0} dialogs` +
      (s.skipped ? ` · ${s.skipped} skipped` : '') +
      (s.failed ? ` · ${s.failed} errors` : ''),
  },
  ar: {
    title: '📨 صندوق الرسائل',
    desc: 'كل محادثات تيليجرام وواتساب، تمامًا مثل نسخة الويب — بدون رموز دخول أو رسائل نظام.',
    tabWhatsapp: '💬 واتساب',
    tabTelegram: '✈️ تيليجرام',
    all: 'الكل',
    clientsOnly: 'العملاء فقط',
    empty: 'لا محادثات بعد. جارٍ المزامنة…',
    emptyClients: 'لا جهات في هذا المجلد.',
    owner: 'مالك',
    client: 'عميل',
    colleague: 'زميل',
    unknown: 'غير معروف',
    review: 'بحاجة لمراجعة',
    reviewTag: 'مراجعة',
    reqBuy: 'شراء',
    reqSell: 'بيع',
    reqRent: 'إيجار',
    reqMortgage: 'تمويل',
    count: (n) => `${n} محادثة`,
    sync: '🔄 مزامنة تيليجرام',
    syncing: 'جارٍ المزامنة…',
    autoSync: '⏳ مزامنة تلقائية مع تيليجرام…',
    typePrivate: 'خاص',
    typeGroup: 'مجموعة',
    typeChannel: 'قناة',
    syncDone: (s) =>
      `تمت المزامنة: ${s.chats ?? 0} محادثة من ${s.dialogs ?? 0}` +
      (s.skipped ? ` · ${s.skipped} متجاهَل` : '') +
      (s.failed ? ` · ${s.failed} أخطاء` : ''),
  },
};

// A stable soft color for the letter-avatar, derived from the chat name.
const AVATAR_COLORS = ['#0e9f6e', '#c69749', '#3b82f6', '#8b5cf6', '#ef4444', '#0891b2', '#d97706', '#db2777'];
function avatarColor(seed = '') {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function initials(name = '') {
  const s = name.trim();
  if (!s) return '?';
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2);
  return (parts[0][0] || '') + (parts[1][0] || '');
}

function formatTime(iso, lang) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const locale = lang === 'fa' ? 'fa-IR' : lang === 'ar' ? 'ar' : 'en-GB';
  if (sameDay) return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
}

const TYPE_ICON = { private: '👤', group: '👥', channel: '📢' };

// Compact AED price, e.g. 2,500,000 → "2.5M", 95,000 → "95k".
function formatPrice(n) {
  if (!n || Number.isNaN(Number(n))) return null;
  const v = Number(n);
  if (v >= 1e6) return `${(v / 1e6).toFixed(v % 1e6 ? 1 : 0)}M`;
  if (v >= 1e3) return `${Math.round(v / 1e3)}k`;
  return String(v);
}

// The extracted-value chips shown under a chat (region, price, beds, request).
function extractedChips(chat, t) {
  const x = chat.extracted || {};
  const req = { buy: t.reqBuy, sell: t.reqSell, rent: t.reqRent, mortgage: t.reqMortgage }[x.request_type];
  const bed = x.bedrooms === 0 ? 'Studio' : x.bedrooms != null ? `${x.bedrooms}🛏` : null;
  const price = formatPrice(x.price);
  return [req, x.region, bed, price && `${price} AED`].filter(Boolean);
}

export default function InboxPage() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const t = STRINGS[lang] || STRINGS.fa;

  const [source, setSource] = useState('telegram'); // 'telegram' | 'whatsapp'
  const [folder, setFolder] = useState('all'); // all | client | owner | colleague | unknown
  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [autoSyncing, setAutoSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  // Remembers which sources we've already auto-synced this session, so opening
  // the tab once triggers a background sync but flipping tabs doesn't spam it.
  const autoSyncedRef = useRef({});

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

  // Auto-sync on open: the first time a source is shown, pull its chat list in
  // the background (like Web Telegram loading your chats when you open it),
  // then load. Telegram has a real backfill endpoint; WhatsApp's history is
  // populated server-side on connect, so here we just (re)load its list.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      if (source === 'telegram' && !autoSyncedRef.current.telegram) {
        autoSyncedRef.current.telegram = true;
        setAutoSyncing(true);
        try {
          await apiFetch('/api/telegram/sync', { method: 'POST', body: {}, token });
        } catch (_err) {
          // Not connected yet or transient — stay quiet for a background sync;
          // the manual button surfaces errors when the user asks explicitly.
        } finally {
          if (!cancelled) setAutoSyncing(false);
        }
      }
      if (!cancelled) await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [token, source, load]);

  const setRole = async (id, role) => {
    try {
      await apiFetch(`/api/chats/${id}/role`, { method: 'POST', body: { role }, token });
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  // Pull the account's Telegram chat list into the inbox, then reload.
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

  // A chat belongs in a category folder only when its label is confident (or
  // set by hand); low-confidence guesses live in "needs review" so a wrong
  // contact never lands in a clean folder.
  const inFolder = useCallback((c, key) => {
    const role = c.role || 'unknown';
    const manual = c.role_source === 'manual';
    if (key === 'all') return true;
    if (key === 'review') return c.needs_review && !manual;
    if (key === 'unknown') return role === 'unknown';
    return role === key && (manual || !c.needs_review);
  }, []);

  const visible = useMemo(() => chats.filter((c) => inFolder(c, folder)), [chats, folder, inFolder]);

  // Category "folders" — each showing its own count.
  const FOLDERS = useMemo(
    () => [
      { key: 'all', label: t.all },
      { key: 'client', label: t.client },
      { key: 'owner', label: t.owner },
      { key: 'colleague', label: t.colleague },
      { key: 'review', label: t.review },
      { key: 'unknown', label: t.unknown },
    ],
    [t]
  );
  const folderCount = useCallback(
    (key) => chats.filter((c) => inFolder(c, key)).length,
    [chats, inFolder]
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
            <button className="btn accent" onClick={handleSync} disabled={syncing || autoSyncing}>
              {autoSyncing ? t.autoSync : syncing ? t.syncing : t.sync}
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

        {/* category folders: همه / مشتری / مالک / همکار / نامشخص */}
        <div className="filters">
          {FOLDERS.map((f) => (
            <div
              key={f.key}
              className={`chip${folder === f.key ? ' active' : ''}`}
              onClick={() => setFolder(f.key)}
            >
              {f.label}
              <span className="chip-count">{folderCount(f.key)}</span>
            </div>
          ))}
        </div>

        {error && <div className="form-error">{error}</div>}
        {syncMsg && <div className="form-notice">{syncMsg}</div>}
        {!loading && visible.length === 0 && (
          <div className="empty-note">{folder === 'all' ? t.empty : t.emptyClients}</div>
        )}

        <div className="chat-list">
          {visible.map((chat) => {
            const name = chat.name || chat.phone || chat.telegram_id || '—';
            const type = chat.chat_type || (chat.context === 'group' ? 'group' : 'private');
            const chips = extractedChips(chat, t);
            const conf = Number(chat.confidence) || 0;
            const manual = chat.role_source === 'manual';
            const showConf = (chat.role && chat.role !== 'unknown') || conf > 0;
            return (
              <div className="chat-row" key={chat.id}>
                <div className="chat-avatar" style={{ background: avatarColor(name) }}>
                  {initials(name)}
                </div>
                <div className="chat-main">
                  <div className="chat-line1">
                    <span className="chat-name">
                      {TYPE_ICON[type] && <span className="chat-type-icon" title={t[`type${type[0].toUpperCase()}${type.slice(1)}`]}>{TYPE_ICON[type]}</span>}
                      {name}
                    </span>
                    <span className="chat-time tabular">{formatTime(chat.last_message_at, lang)}</span>
                  </div>
                  <div className="chat-line2">
                    <span className="chat-preview">{chat.last_message || ''}</span>
                    {chat.unread > 0 && <span className="chat-unread">{chat.unread}</span>}
                  </div>
                  {chips.length > 0 && (
                    <div className="chat-chips">
                      {chips.map((c, i) => (
                        <span className="ex-chip" key={i}>{c}</span>
                      ))}
                    </div>
                  )}
                  <div className="chat-line3">
                    <select
                      className={`role-select role-${chat.role || 'unknown'}`}
                      value={chat.role || 'unknown'}
                      onChange={(e) => setRole(chat.id, e.target.value)}
                    >
                      <option value="client">{t.client}</option>
                      <option value="owner">{t.owner}</option>
                      <option value="colleague">{t.colleague}</option>
                      <option value="unknown">{t.unknown}</option>
                    </select>
                    {manual ? (
                      <span className="conf-badge manual">✓</span>
                    ) : (
                      showConf && (
                        <span className={`conf-badge${conf >= 65 ? ' hi' : ' mid'}`}>{conf}%</span>
                      )
                    )}
                    {chat.needs_review && !manual && <span className="review-tag">⚠ {t.reviewTag}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
