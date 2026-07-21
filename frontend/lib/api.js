// Thin fetch wrapper shared by the whole frontend (dashboard pages via
// apiFetch, and the WhatsApp/Telegram connection components via apiUrl).
'use client';

// Next.js inlines NEXT_PUBLIC_* variables at BUILD time, so each name must be
// referenced literally here (a dynamic process.env[name] lookup would NOT be
// inlined and would read as undefined in the browser). We accept BOTH
// NEXT_PUBLIC_API_URL and NEXT_PUBLIC_API_BASE_URL so it doesn't matter which
// one the Vercel project sets. Trailing slashes are stripped so joining a
// "/api/..." path never produces a double slash (e.g. "https://x.com//api").
//
// ⚠️ Because this is baked in at build time, changing the variable in Vercel
// requires a REDEPLOY to take effect — setting it without redeploying keeps
// the old (or empty) value.
export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  ''
).replace(/\/+$/, '');

// Debug marker — printed once when this module first loads in the browser, so
// the deployed build's configured backend URL is visible in the console.
// A distinctive prefix also proves whether the NEW build is live at all.
if (typeof window !== 'undefined') {
  // eslint-disable-next-line no-console
  console.log('[maskanyar] API_BASE_URL =', API_BASE_URL || '(خالی!)');
}

/** Joins the configured base URL with an API path, guaranteeing exactly one
 *  slash between them. */
export function apiUrl(path) {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${suffix}`;
}

/** Resolves an API path to the ABSOLUTE url the browser will actually hit.
 *  When API_BASE_URL is empty this returns the current origin + path, which
 *  is exactly the clue we want in error messages — it makes "the frontend
 *  never learned the backend URL" visually obvious on-device. */
function absoluteUrl(path) {
  const u = apiUrl(path);
  if (typeof window !== 'undefined') {
    try {
      return new URL(u, window.location.origin).href;
    } catch {
      /* fall through */
    }
  }
  return u;
}

export async function apiFetch(path, { method = 'GET', body, token } = {}) {
  const target = absoluteUrl(path);
  let res;
  try {
    res = await fetch(apiUrl(path), {
      method,
      mode: 'cors', // explicit (this is already the default for cross-origin requests)
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    // A network-level failure (CORS block, wrong/unreachable host, DNS,
    // mixed content) rejects the fetch here — before any HTTP status exists.
    // Surface the exact URL + base so the on-screen red message is
    // self-diagnostic (no browser devtools needed).
    throw new Error(
      `اتصال ناموفق به «${target}» — ${err.message}. ` +
        `(آدرس پایه‌ی بک‌اند: ${API_BASE_URL || '❗️خالی است — متغیر NEXT_PUBLIC_API_URL در Vercel تنظیم/دیپلوی نشده'})`
    );
  }

  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `درخواست «${target}» با کد ${res.status} شکست خورد`);
  }
  return data;
}

/** Uploads a raw text body (e.g. a WhatsApp export file's contents) to an API
 *  path. Kept separate from apiFetch because that one always sends JSON; here
 *  the body is text/plain so the server can stream a large file without
 *  JSON-escaping it. Returns the parsed JSON response. */
export async function apiPostText(path, text, { token } = {}) {
  const target = absoluteUrl(path);
  let res;
  try {
    res = await fetch(apiUrl(path), {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: text,
    });
  } catch (err) {
    throw new Error(
      `اتصال ناموفق به «${target}» — ${err.message}. ` +
        `(آدرس پایه‌ی بک‌اند: ${API_BASE_URL || '❗️خالی است — متغیر NEXT_PUBLIC_API_URL در Vercel تنظیم/دیپلوی نشده'})`
    );
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `درخواست «${target}» با کد ${res.status} شکست خورد`);
  }
  return data;
}
