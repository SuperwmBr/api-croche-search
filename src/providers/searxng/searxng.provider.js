import { env } from '../../config/env.js';
import { detectType } from '../../classification/type.js';
import { computeCrochetConfidence } from '../../classification/crochet-confidence.js';

export async function searchSearxng({ query, limit, safeSearch, signal }) {
  const url = new URL('/search', env.SEARXNG_URL);
  url.search = new URLSearchParams({ q: query, format: 'json', language: 'pt-BR', safesearch: safeSearch, categories: 'general' });
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal });
  if (!response.ok) throw new Error(`SearXNG request failed (${response.status})`);
  const body = await response.json();
  return { configured: true, results: (body.results ?? []).slice(0, limit).map((item, index) => ({
    id: `searxng:${Buffer.from(item.url).toString('base64url').slice(0, 24)}`, externalId: item.url, type: detectType(item.url, 'artigo'), origin: item.engine ?? 'web',
    title: item.title, description: item.content, url: item.url, image: item.img_src ?? item.thumbnail, author: null, language: 'pt-BR',
    publishedAt: item.publishedDate ?? null, tags: item.category ? [item.category] : [],
    rankingSignals: { textualRelevance: Math.max(0.4, 0.85 - index * 0.02), sourceQuality: 0.55, crochetConfidence: computeCrochetConfidence(item.title, item.content), freshness: item.publishedDate ? 0.6 : 0.3, engagement: 0.25, completeness: 0.5 }
  })) };
}
