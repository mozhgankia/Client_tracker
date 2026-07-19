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

/** Joins the configured base URL with an API path, guaranteeing exactly one
 *  slash between them. */
export function apiUrl(path) {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${suffix}`;
}

export async function apiFetch(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(apiUrl(path), {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `درخواست ${path} شکست خورد`);
  return data;
}
