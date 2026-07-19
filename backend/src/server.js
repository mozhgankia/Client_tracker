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

const app = express();

// The frontend (Vercel) and backend (Render) are deployed on different
// origins by design (see backend/DEPLOY_RENDER.md) — CORS has to be
// explicit. CORS_ORIGIN is a comma-separated allowlist (e.g. the Vercel
// production URL + preview-deploy URLs); with nothing set, every origin is
// reflected (fine for local dev, but always set it in production).
//
// Origins are compared with trailing slashes stripped, so it doesn't matter
// whether CORS_ORIGIN is "https://x.vercel.app" or "https://x.vercel.app/" —
// a trailing-slash mismatch is the single most common reason a correctly
// configured allowlist still gets blocked by the browser.
const stripSlash = (s) => s.replace(/\/+$/, '');
const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((o) => stripSlash(o.trim()))
  .filter(Boolean);

function isAllowedOrigin(origin) {
  // Non-browser callers (curl, health checks, server-to-server) send no
  // Origin header — always allow those.
  if (!origin) return true;
  // No allowlist configured → reflect whatever origin asked (allow all).
  if (allowedOrigins.length === 0) return true;
  // Explicit allowlist match (trailing slash ignored).
  if (allowedOrigins.includes(stripSlash(origin))) return true;
  // Vercel gives every deploy its own hashed *.vercel.app URL that changes on
  // each push (e.g. client-tracker-<hash>-<user>.vercel.app), so allow any of
  // them — otherwise a new frontend deploy would need a CORS_ORIGIN edit every
  // single time. The API itself is still protected by the JWT on every
  // tenant-scoped route; CORS only governs which browser origins may call it.
  try {
    if (new URL(origin).hostname.endsWith('.vercel.app')) return true;
  } catch {
    /* not a valid URL — fall through to reject */
  }
  return false;
}

const corsOptions = {
  origin(origin, callback) {
    const ok = isAllowedOrigin(origin);
    if (!ok) console.warn(`[cors] rejected origin: ${origin} (allowed: ${allowedOrigins.join(', ') || '(all)'})`);
    return callback(null, ok);
  },
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // answer every preflight (OPTIONS) request explicitly

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

// --- WhatsApp connection endpoints. requireAuth reads the tenant's own
// userId from the verified JWT (req.userId) — never from the URL or body —
// so one tenant can never start/stop/inspect another tenant's connection.
app.post('/api/whatsapp/connect', requireAuth, async (req, res) => {
  try {
    await startWhatsAppConnection(req.userId);
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
