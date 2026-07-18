// Thin fetch wrapper shared by the dashboard pages. WhatsAppConnection.jsx
// and TelegramConnection.jsx call fetch directly (they were built and
// approved before this file existed) — this is for every page added since.
'use client';

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '';

export async function apiFetch(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
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
