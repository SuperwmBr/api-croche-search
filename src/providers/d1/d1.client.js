import { env } from '../../config/env.js';

export async function queryD1(sql, params = [], { signal } = {}) {
  if (!env.d1Configured) return { configured: false, results: [] };
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${env.CLOUDFLARE_D1_DATABASE_ID}/query`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
    signal
  });
  const body = await response.json();
  if (!response.ok || !body.success) throw new Error(`D1 request failed (${response.status})`);
  return { configured: true, results: body.result?.[0]?.results ?? [], meta: body.result?.[0]?.meta ?? null };
}
