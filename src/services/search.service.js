import { createHash } from 'node:crypto';
import { memoryCache } from '../cache/memory-cache.js';
import { deduplicateResults } from '../deduplication/deduplicate.js';
import { calculateScore } from '../ranking/rank.js';
import { expandQuery } from './query-expansion.service.js';
import { searchInternal } from '../providers/d1/d1.provider.js';
import { searchYouTube } from '../providers/youtube/youtube.provider.js';
import { searchSearxng } from '../providers/searxng/searxng.provider.js';
import { searchMeilisearch } from '../providers/meilisearch/meilisearch.provider.js';
import { buildSourceQueries, categoriesForSource } from '../classification/source.js';
import { env } from '../config/env.js';

const cacheKey = (params) => createHash('sha256').update(JSON.stringify(params)).digest('hex');
const timeoutSignal = (ms) => AbortSignal.timeout(ms);
const isProviderFailure = (status) => status === 'error' || status === 'timeout' || status === 'partial';
const CROCHET_CONFIDENCE_THRESHOLD = 0.5;

function rankAndFilter(items) {
  return deduplicateResults(
    items
      .map((item) => ({ ...item, score: calculateScore(item.rankingSignals ?? {}) }))
      .filter((item) => (item.rankingSignals?.crochetConfidence ?? 0) >= CROCHET_CONFIDENCE_THRESHOLD)
      .sort((a, b) => b.score - a.score)
  );
}

function buildCalls(params, query, offset) {
  const filters = [
    params.tipo?.length ? `type IN [${params.tipo.map((value) => `"${value}"`).join(',')}]` : null,
    params.idioma ? `language = "${params.idioma}"` : null,
    params.nivel ? `level = "${params.nivel}"` : null
  ].filter(Boolean);

  if (!params.fonte?.length) {
    return {
      internal: () => searchInternal({ query, limit: params.limit, offset, signal: timeoutSignal(env.SEARCH_PROVIDER_TIMEOUT_MS) }).then((results) => ({ configured: env.d1Configured, results })),
      youtube: () => searchYouTube({ query, limit: params.limit, signal: timeoutSignal(env.SEARCH_PROVIDER_TIMEOUT_MS) }),
      searxng: () => searchSearxng({ query, limit: params.limit * 2, safeSearch: params.safe_search, signal: timeoutSignal(env.SEARXNG_TIMEOUT_MS), pages: 2 }),
      meilisearch: () => searchMeilisearch({ query, limit: params.limit, offset, filters, signal: timeoutSignal(env.MEILISEARCH_TIMEOUT_MS) })
    };
  }

  const searxPages = params.fonte.length >= 4 ? 2 : 3;

  return Object.fromEntries(params.fonte.map((source) => {
    if (source === 'internal') {
      return [source, () => searchInternal({ query, limit: params.limit_por_fonte, offset, signal: timeoutSignal(env.SEARCH_PROVIDER_TIMEOUT_MS) }).then((results) => ({ configured: env.d1Configured, results }))];
    }
    if (source === 'youtube') {
      return [source, () => searchYouTube({ query, limit: params.limit_por_fonte, signal: timeoutSignal(env.SEARCH_PROVIDER_TIMEOUT_MS) })];
    }
    const queries = buildSourceQueries(query, source);
    return [source, () => searchSearxng({
      query: queries[0],
      queries,
      limit: params.limit_por_fonte * 3,
      targetResults: params.limit_por_fonte,
      safeSearch: params.safe_search,
      signal: timeoutSignal(env.SEARXNG_TIMEOUT_MS),
      source,
      categories: categoriesForSource(source),
      pages: searxPages
    })];
  }));
}

export async function search(params) {
  const key = cacheKey(params);
  const cached = memoryCache.get(key);
  if (cached) return { ...cached, cache: { layer: 'memory', hit: true } };

  const startedAt = performance.now();
  const variants = expandQuery(params.q);
  const query = variants[0];
  const pageSize = params.fonte?.length ? params.limit_por_fonte : params.limit;
  const offset = (params.page - 1) * pageSize;
  const calls = buildCalls(params, query, offset);
  const names = Object.keys(calls);
  const settled = await Promise.allSettled(names.map((name) => calls[name]()));
  const providers = {};
  const providerDetails = {};
  const grouped = {};

  settled.forEach((outcome, index) => {
    const name = names[index];
    if (outcome.status === 'rejected') {
      providers[name] = outcome.reason?.name === 'TimeoutError' ? 'timeout' : 'error';
      providerDetails[name] = { error: outcome.reason?.message ?? 'provider_failed' };
      grouped[name] = [];
    } else if (!outcome.value.configured) {
      providers[name] = 'not_configured';
      providerDetails[name] = null;
      grouped[name] = [];
    } else {
      providers[name] = outcome.value.partial ? 'partial' : 'ok';
      providerDetails[name] = outcome.value.diagnostics ?? null;
      grouped[name] = rankAndFilter(outcome.value.results);
    }
  });

  let results;
  let sourceCounts;
  if (params.fonte?.length) {
    results = params.fonte.flatMap((source) => (grouped[source] ?? []).slice(0, params.limit_por_fonte));
    sourceCounts = Object.fromEntries(params.fonte.map((source) => [source, Math.min((grouped[source] ?? []).length, params.limit_por_fonte)]));
  } else {
    const combined = rankAndFilter(Object.values(grouped).flat());
    results = combined.slice(0, params.limit);
    sourceCounts = results.reduce((counts, item) => ({ ...counts, [item.origin]: (counts[item.origin] ?? 0) + 1 }), {});
  }

  const payload = {
    query: params.q,
    expandedQueries: variants,
    requestedSources: params.fonte ?? null,
    total: results.length,
    page: params.page,
    limit: pageSize,
    limitMode: params.fonte?.length ? 'per_source' : 'total',
    partial: Object.values(providers).some(isProviderFailure),
    providers,
    providerDetails,
    sourceCounts,
    elapsedMs: Math.round(performance.now() - startedAt),
    results,
    cache: { layer: null, hit: false }
  };

  memoryCache.set(key, payload);
  return payload;
}
