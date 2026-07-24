// Stateless Express API — no local disk writes anywhere in this process.
// All state (WhatsApp/Telegram sessions, leads, listings) lives in Supabase,
// so this process can restart or be replaced by Render/Hugging Face Spaces
// at any time without losing anything.
'use strict';

const express = require('express');
const cors = require('cors');
const supabase = require('./db/supabaseClient');
const {
  startTelegramListener,
  getConnectionInfo: getTelegramConnectionInfo,
  disconnectTelegram,
} = require('./telegram/listener');
const { startPhoneLogin, submitCode, submitPassword } = require('./telegram/authFlow');
const {
  startWhatsAppConnection,
  disconnectWhatsApp,
  getConnectionInfo,
  resumeAllTenantConnections,
} = require('./whatsapp/connection');
const authRoutes = require('./auth/routes');
const { requireAuth } = require('./auth/middleware');
const customerRoutes = require('./routes/customers');
const propertyRoutes = require('./routes/properties');
const leadRoutes = require('./routes/leads');
const settingsRoutes = require('./routes/settings');
const classificationRoutes = require('./routes/classification');
const a2aRoutes = require('./routes/a2a');
const profileRoutes = require('./routes/profile');
const { importWhatsAppExport } = require('./import/importWhatsAppExport');

const app = express();

// TEMPORARY (debugging): allow ALL origins so CORS can be ruled out entirely
// while we track down the deploy issue. This is safe short-term because every
// tenant-scoped route is still protected by the JWT — CORS only governs which
// browser origins may call the API, not whether the caller is authorized.
// Once the connection works end to end, tighten this back to an allowlist
// (see git history for the origin-function version).
app.use(cors({ origin: '*' }));
app.options('*', cors({ origin: '*' }));

app.use(express.json());

const PORT = process.env.PORT || 3000;

app.get('/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use('/api/auth', authRoutes);

// --- Data CRUD: customers, properties (primary + secondary), and the leads
// the AI pipeline finds. requireAuth here means req.userId is set for every
// route in these routers — each one filters/checks ownership on it, so a
// tenant can only ever see or change their own rows.
app.use('/api/customers', requireAuth, customerRoutes);
app.use('/api/properties', requireAuth, propertyRoutes);
app.use('/api/leads', requireAuth, leadRoutes);
app.use('/api/settings', requireAuth, settingsRoutes);
app.use('/api/classification', requireAuth, classificationRoutes);
app.use('/api/a2a', requireAuth, a2aRoutes);
app.use('/api/profile', requireAuth, profileRoutes);

// --- Back-fill: import an exported WhatsApp chat (.txt) and run every message
// through the same keyword-filter -> Gemini -> saveLead pipeline as live
// messages, so old conversations produce the same review-ready leads. The
// file is sent as a raw text body (not JSON) so large exports don't pay the
// cost of JSON-escaping; express.text parses it just for this route. The
// tenant is always req.userId from the verified JWT.
app.post(
  '/api/import/whatsapp',
  requireAuth,
  express.text({ type: () => true, limit: '15mb' }),
  async (req, res) => {
    try {
      const content = req.body;
      if (typeof content !== 'string' || content.trim().length < 10) {
        return res.status(400).json({ error: 'فایل اکسپورت خالی یا نامعتبر است.' });
      }
      const label = typeof req.query.label === 'string' ? req.query.label : undefined;
      const stats = await importWhatsAppExport(req.userId, content, { chatLabel: label });
      res.json(stats);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// --- WhatsApp connection endpoints. requireAuth reads the tenant's own
// userId from the verified JWT (req.userId) — never from the URL or body —
// so one tenant can never start/stop/inspect another tenant's connection.
app.post('/api/whatsapp/connect', requireAuth, async (req, res) => {
  try {
    const { phone } = req.body || {};
    await startWhatsAppConnection(req.userId, phone);
    res.json(getConnectionInfo(req.userId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/whatsapp/status', requireAuth, (req, res) => {
  res.json(getConnectionInfo(req.userId));
});

app.post('/api/whatsapp/disconnect', requireAuth, async (req, res) => {
  try {
    await disconnectWhatsApp(req.userId);
    res.json(getConnectionInfo(req.userId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Telegram connection endpoints. Same rule as WhatsApp above: the tenant
// always comes from the verified JWT (req.userId), never the request body.
// Login is a 3-step handshake (phone -> code -> optional 2FA password)
// because Telegram's own login flow is inherently multi-step; each step is
// its own request so the frontend can render the right screen in between.
app.post('/api/telegram/connect', requireAuth, async (req, res) => {
  try {
    const { phone } = req.body || {};
    if (!phone) return res.status(400).json({ error: 'شماره تلفن الزامی است.' });
    res.json(await startPhoneLogin(req.userId, phone));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/telegram/verify-code', requireAuth, async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: 'کد تأیید الزامی است.' });
    res.json(await submitCode(req.userId, code));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/telegram/verify-password', requireAuth, async (req, res) => {
  try {
    const { password } = req.body || {};
    if (!password) return res.status(400).json({ error: 'رمز دومرحله‌ای الزامی است.' });
    res.json(await submitPassword(req.userId, password));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/telegram/status', requireAuth, (req, res) => {
  res.json(getTelegramConnectionInfo(req.userId));
});

app.post('/api/telegram/disconnect', requireAuth, async (req, res) => {
  try {
    await disconnectTelegram(req.userId);
    res.json(getTelegramConnectionInfo(req.userId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

// --- Start a Telegram listener for every tenant that has a saved session.
// Called once at boot; a fresh login via /api/telegram/connect + verify-code
// (+ verify-password) starts its own listener immediately afterwards, so a
// tenant never has to wait for the next restart.
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
  resumeAllTenantConnections();
});
