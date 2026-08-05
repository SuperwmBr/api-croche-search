import { createHash } from 'node:crypto';
import { memoryCache } from '../cache/memory-cache.js';
import { deduplicateResults } from '../deduplication/deduplicate.js';
import { calculateScore } from '../ranking/rank.js';
import { expandQuery } from './query-expansion.service.js';
import { searchInternal } from '../providers/d1/d1.provider.js';
import { searchYouTube } from '../providers/youtube/youtube.provider.js';
import { searchSearxng } from '../providers/searxng/searxng.provider.js';
import { searchMeilisearch } from '../providers/meilisearch/meilisearch.provider.js';
import { env } from '../config/env.js';

const cacheKey = (params) => createHash('sha256').update(JSON.stringify(params)).digest('hex');
const timeoutSignal = (ms) => AbortSignal.timeout(ms);

export async function search(params) {
  const key = cacheKey(params);
  const cached = memoryCache.get(key);
  if (cached) return { ...cached, cache: { layer: 'memory', hit: true } };

  const startedAt = performance.now();
  const variants = expandQuery(params.q);
  const query = variants[0];
  const offset = (params.page - 1) * params.limit;
  const filters = [params.tipo?.length ? `type IN [${params.tipo.map((v) => `"${v}"`).join(',')}]` : null, params.idioma ? `language = "${params.idioma}"` : null, params.nivel ? `level = "${params.nivel}"` : null].filter(Boolean);
  const calls = {
    internal: () => searchInternal({ query, limit: params.limit, offset, signal: timeoutSignal(env.SEARCH_PROVIDER_TIMEOUT_MS) }).then((results) => ({ configured: env.d1Configured, results })),
    youtube: () => searchYouTube({ query, limit: params.limit, signal: timeoutSignal(env.SEARCH_PROVIDER_TIMEOUT_MS) }),
    searxng: () => searchSearxng({ query, limit: params.limit, safeSearch: params.safe_search, signal: timeoutSignal(env.SEARXNG_TIMEOUT_MS) }),
    meilisearch: () => searchMeilisearch({ query, limit: params.limit, offset, filters, signal: timeoutSignal(env.MEILISEARCH_TIMEOUT_MS) })
  };
  const names = Object.keys(calls);
  const settled = await Promise.allSettled(names.map((name) => calls[name]()));
  const providers = {};
  const raw = [];
  settled.forEach((outcome, index) => {
    const name = names[index];
    if (outcome.status === 'rejected') providers[name] = outcome.reason?.name === 'TimeoutError' ? 'timeout' : 'error';
    else if (!outcome.value.configured) providers[name] = 'not_configured';
    else { providers[name] = 'ok'; raw.push(...outcome.value.results); }
  });
  const ranked = raw.map((item) => ({ ...item, score: calculateScore(item.rankingSignals ?? {}) })).sort((a, b) => b.score - a.score);
  const results = deduplicateResults(ranked).slice(0, params.limit);
  const payload = { query: params.q, expandedQueries: variants, total: results.length, page: params.page, limit: params.limit, partial: Object.values(providers).some((status) => status !== 'ok'), providers, elapsedMs: Math.round(performance.now() - startedAt), results, cache: { layer: null, hit: false } };
  memoryCache.set(key, payload);
  return payload;
}
