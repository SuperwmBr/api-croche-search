import { env } from '../../config/env.js';

export async function searchMeilisearch({ query, limit, offset, filters, signal }) {
  if (!env.meilisearchConfigured) return { configured: false, results: [] };
  const response = await fetch(`${env.MEILISEARCH_HOST}/indexes/${encodeURIComponent(env.MEILISEARCH_INDEX)}/search`, {
    method: 'POST', headers: { Authorization: `Bearer ${env.MEILISEARCH_MASTER_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, limit, offset, filter: filters.length ? filters : undefined, showRankingScore: true }), signal
  });
  if (!response.ok) throw new Error(`Meilisearch request failed (${response.status})`);
  const body = await response.json();
  return { configured: true, results: (body.hits ?? []).map((hit) => ({ ...hit, id: `meilisearch:${hit.id}`, externalId: String(hit.id), origin: hit.origin ?? 'index', rankingSignals: { textualRelevance: hit._rankingScore ?? 0.7, sourceQuality: hit.sourceQuality ?? 0.7, crochetConfidence: hit.crochetConfidence ?? 0.8, freshness: hit.freshness ?? 0.5, engagement: hit.engagement ?? 0.4, completeness: hit.completeness ?? 0.7 } })) };
}
