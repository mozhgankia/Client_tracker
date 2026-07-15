// Stateless Express API — no local disk writes anywhere in this process.
// All state (WhatsApp/Telegram sessions, leads, listings) lives in Supabase,
// so this process can restart or be replaced by Render/Hugging Face Spaces
// at any time without losing anything.
'use strict';

const express = require('express');
const supabase = require('./db/supabaseClient');
const { startTelegramListener } = require('./telegram/listener');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.get('/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// --- Keep-alive: free-tier hosts (Render, Hugging Face Spaces) spin the
// container down after a period of inbound inactivity. Pinging our own
// /health endpoint every 10 minutes keeps it awake. This only matters once
// the app is actually deployed (PUBLIC_URL set) — it's a no-op locally.
function startKeepAlivePing() {
  const publicUrl = process.env.PUBLIC_URL;
  if (!publicUrl) {
    console.log('[keep-alive] PUBLIC_URL تنظیم نشده — پینگ خودکار غیرفعال است (طبیعی برای اجرای محلی).');
    return;
  }
  const TEN_MINUTES = 10 * 60 * 1000;
  setInterval(() => {
    fetch(`${publicUrl}/health`).catch((err) => console.warn('[keep-alive] پینگ ناموفق:', err.message));
  }, TEN_MINUTES);
}

// --- Start a Telegram listener for every tenant that has connected one.
// Called once at boot; the dashboard's "connect Telegram" action should call
// startTelegramListener(userId) again right after a tenant finishes login.js
// so it doesn't wait for the next full restart.
async function startAllTenantListeners() {
  const { data: sessions, error } = await supabase.from('telegram_sessions').select('user_id');
  if (error) {
    console.error('[startup] خواندن فهرست نشست‌های تلگرام شکست خورد:', error.message);
    return;
  }
  for (const { user_id: userId } of sessions || []) {
    startTelegramListener(userId).catch((err) =>
      console.error(`[startup] راه‌اندازی شنود تلگرام برای ${userId} شکست خورد:`, err.message)
    );
  }
}

app.listen(PORT, () => {
  console.log(`[server] روی پورت ${PORT} در حال اجراست`);
  startKeepAlivePing();
  startAllTenantListeners();
});
