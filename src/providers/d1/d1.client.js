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
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.success) {
    const detalhes = Array.isArray(body.errors)
      ? body.errors.map((item) => item?.message || item?.code || String(item)).filter(Boolean).join('; ')
      : body.error?.message || body.message || '';
    const mensagem = `D1 request failed (${response.status})${detalhes ? `: ${detalhes}` : ''}`;
    console.error('[D1] consulta rejeitada', { status: response.status, detalhes, sql });
    throw new Error(mensagem);
  }
  return { configured: true, results: body.result?.[0]?.results ?? [], meta: body.result?.[0]?.meta ?? null };
}
