import { env } from '../../config/env.js';
import { detectType } from '../../classification/type.js';
import { computeCrochetConfidence } from '../../classification/crochet-confidence.js';
import { sourceFromUrl, matchesSource } from '../../classification/source.js';

async function fetchPage({ query, safeSearch, categories, page, signal }) {
  const url = new URL('/search', env.SEARXNG_URL);
  url.search = new URLSearchParams({
    q: query,
    format: 'json',
    language: 'pt-BR',
    safesearch: safeSearch,
    categories,
    pageno: String(page)
  });
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal });
  if (!response.ok) throw new Error(`SearXNG request failed (${response.status})`);
  return response.json();
}

export async function searchSearxng({ query, limit, safeSearch, signal, source = 'all', categories = 'general', pages = 1 }) {
  const pageNumbers = Array.from({ length: Math.max(1, Math.min(pages, 3)) }, (_, index) => index + 1);
  const bodies = await Promise.all(pageNumbers.map((page) => fetchPage({ query, safeSearch, categories, page, signal })));
  const seen = new Set();
  const raw = bodies.flatMap((body) => body.results ?? []).filter((item) => {
    if (!item?.url || seen.has(item.url)) return false;
    seen.add(item.url);
    return source === 'all' || matchesSource(item.url, source);
  }).slice(0, limit);

  return {
    configured: true,
    results: raw.map((item, index) => {
      const origin = source === 'all' ? sourceFromUrl(item.url, 'web') : source;
      return {
        id: `searxng:${Buffer.from(item.url).toString('base64url').slice(0, 24)}`,
        externalId: item.url,
        type: detectType(item.url, 'artigo'),
        origin,
        provider: 'searxng',
        engine: item.engine ?? null,
        title: item.title,
        description: item.content,
        url: item.url,
        image: item.img_src ?? item.thumbnail ?? '',
        author: null,
        language: 'pt-BR',
        publishedAt: item.publishedDate ?? null,
        tags: item.category ? [item.category] : [],
        rankingSignals: {
          textualRelevance: Math.max(0.4, 0.85 - index * 0.01),
          sourceQuality: 0.55,
          crochetConfidence: computeCrochetConfidence(item.title, item.content),
          freshness: item.publishedDate ? 0.6 : 0.3,
          engagement: 0.25,
          completeness: item.img_src || item.thumbnail ? 0.65 : 0.5
        }
      };
    })
  };
}
