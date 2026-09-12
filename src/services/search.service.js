import { createHash } from 'node:crypto';
import { memoryCache } from '../cache/memory-cache.js';
import { deduplicateResults } from '../deduplication/deduplicate.js';
import { calculateScore } from '../ranking/rank.js';
import { expandQuery } from './query-expansion.service.js';
import { searchInternal } from '../providers/d1/d1.provider.js';
import { searchYouTube } from '../providers/youtube/youtube.provider.js';
import { searchSearxng } from '../providers/searxng/searxng.provider.js';
import { searchMeilisearch } from '../providers/meilisearch/meilisearch.provider.js';
import { searchValueSerp } from '../providers/valueserp/valueserp.provider.js';
import { searchPinterest } from '../providers/pinterest/pinterest.provider.js';
import { persistSearchResults } from '../persistence/search-results.persistence.js';
import { buildSourceQueries, categoriesForSource } from '../classification/source.js';
import { env } from '../config/env.js';

const cacheKey = (params) => createHash('sha256').update(JSON.stringify(params)).digest('hex');
const timeoutSignal = (ms) => AbortSignal.timeout(ms);
const isProviderFailure = (status) => status === 'error' || status === 'timeout' || status === 'partial';
const CROCHET_CONFIDENCE_THRESHOLD = 0.5;

function rankAndFilter(items, allowedTypes = null) {
  return deduplicateResults(
    items
      .map((item) => ({ ...item, score: calculateScore(item.rankingSignals ?? {}) }))
      .filter((item) => (item.rankingSignals?.crochetConfidence ?? 0) >= CROCHET_CONFIDENCE_THRESHOLD)
      .filter((item) => !allowedTypes?.length || allowedTypes.includes(item.type))
      .sort((a, b) => b.score - a.score)
  );
}

function buildValueSerpCall(params, query) {
  return () => searchValueSerp({
    query,
    limit: params.limit,
    page: params.todas_paginas ? 1 : params.page,
    allPages: params.todas_paginas,
    maxPages: params.max_paginas,
    searchType: params.valueserp_tipo || 'images',
    signal: timeoutSignal(env.valueserpTotalTimeoutMs)
  });
}

function buildPinterestCall(params, query) {
  return () => searchPinterest({
    query,
    limit: params.limit,
    allPages: params.todas_paginas,
    maxPages: params.max_paginas,
    signal: timeoutSignal(env.pinterestTotalTimeoutMs)
  });
}

function buildSearxngCall(params, query, variants, source = 'all') {
  const sourceVariants = source === 'all' ? variants : variants.flatMap((variant) => buildSourceQueries(variant, source));
  return () => searchSearxng({
    query: sourceVariants[0],
    queries: sourceVariants,
    limit: source === 'all' ? params.limit * 2 : params.limit_por_fonte * 3,
    targetResults: source === 'all' ? params.limit : params.limit_por_fonte,
    safeSearch: params.safe_search,
    signal: timeoutSignal(env.SEARXNG_TIMEOUT_MS),
    source,
    categories: source === 'all' ? 'general' : categoriesForSource(source),
    pages: source === 'all' ? 2 : params.fonte.length >= 4 ? 2 : 3
  });
}

function buildCalls(params, variants, offset) {
  const query = variants[0];
  const provider = params.provedor !== 'auto' ? params.provedor : params.provider || 'auto';
  const filters = [
    params.tipo?.length ? `type IN [${params.tipo.map((value) => `"${value}"`).join(',')}]` : null,
    params.idioma ? `language = "${params.idioma}"` : null,
    params.nivel ? `level = "${params.nivel}"` : null
  ].filter(Boolean);

  if (provider === 'valueserp') return { valueserp: buildValueSerpCall(params, query) };
  if (provider === 'scraping') return { scraping: buildPinterestCall(params, query) };

  if (!params.fonte?.length) {
    if (provider === 'searxng') return { searxng: buildSearxngCall(params, query, variants) };
    return {
      internal: () => searchInternal({ query, limit: params.limit, offset, signal: timeoutSignal(env.SEARCH_PROVIDER_TIMEOUT_MS) }).then((results) => ({ configured: env.d1Configured, results })),
      youtube: () => searchYouTube({ query, limit: params.limit, signal: timeoutSignal(env.SEARCH_PROVIDER_TIMEOUT_MS) }),
      searxng: buildSearxngCall(params, query, variants),
      meilisearch: () => searchMeilisearch({ query, limit: params.limit, offset, filters, signal: timeoutSignal(env.MEILISEARCH_TIMEOUT_MS) })
    };
  }

  return Object.fromEntries(params.fonte.map((source) => {
    if (source === 'internal') {
      return [source, () => searchInternal({ query, limit: params.limit_por_fonte, offset, signal: timeoutSignal(env.SEARCH_PROVIDER_TIMEOUT_MS) }).then((results) => ({ configured: env.d1Configured, results }))];
    }
    if (source === 'youtube') {
      return [source, () => searchYouTube({ query, limit: params.limit_por_fonte, signal: timeoutSignal(env.SEARCH_PROVIDER_TIMEOUT_MS) })];
    }
    return [source, buildSearxngCall(params, query, variants, source)];
  }));
}

function sourceSelected(item, sources) {
  return sources.includes(item.origin) || (sources.includes('web') && item.origin === 'web');
}

export async function search(params) {
  const key = cacheKey(params);
  const cached = memoryCache.get(key);
  if (cached) return { ...cached, cache: { layer: 'memory', hit: true } };

  const startedAt = performance.now();
  const graphFocused = params.tipo?.includes('grafico');
  const variants = expandQuery(params.q, graphFocused ? 8 : 5, { types: params.tipo });
  const pageSize = params.fonte?.length ? params.limit_por_fonte : params.limit;
  const offset = (params.page - 1) * pageSize;
  const calls = buildCalls(params, variants, offset);
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
      providerDetails[name] = outcome.value.diagnostics ?? null;
      grouped[name] = [];
    } else {
      providers[name] = outcome.value.partial ? 'partial' : 'ok';
      providerDetails[name] = outcome.value.diagnostics ?? null;
      grouped[name] = rankAndFilter(outcome.value.results, params.tipo);
    }
  });

  const allFetched = rankAndFilter(Object.values(grouped).flat(), params.tipo);
  const provider = params.provedor !== 'auto' ? params.provedor : params.provider || 'auto';
  const returnAllFetched = params.todas_paginas && ['scraping', 'valueserp'].includes(provider);
  let results;
  let sourceCounts;
  if (params.fonte?.length && provider === 'auto') {
    results = params.fonte.flatMap((source) => (grouped[source] ?? []).slice(0, params.limit_por_fonte));
    sourceCounts = Object.fromEntries(params.fonte.map((source) => [source, Math.min((grouped[source] ?? []).length, params.limit_por_fonte)]));
  } else if (params.fonte?.length) {
    const selected = allFetched.filter((item) => sourceSelected(item, params.fonte));
    results = returnAllFetched ? selected : selected.slice(0, params.limit_por_fonte * params.fonte.length);
    sourceCounts = Object.fromEntries(params.fonte.map((source) => [source, results.filter((item) => item.origin === source).length]));
  } else {
    results = returnAllFetched ? allFetched : allFetched.slice(0, params.limit);
    sourceCounts = results.reduce((counts, item) => ({ ...counts, [item.origin]: (counts[item.origin] ?? 0) + 1 }), {});
  }

  let persistence = { configured: env.d1Configured, persisted: 0, duplicates: 0 };
  if (env.d1Configured && allFetched.length) {
    try {
      persistence = await persistSearchResults(allFetched, { signal: timeoutSignal(env.SEARCH_PROVIDER_TIMEOUT_MS) });
    } catch (error) {
      persistence = { configured: true, persisted: 0, duplicates: 0, error: error?.message || 'd1_persistence_failed' };
      console.error('[search-persistence]', error?.message || error);
    }
  }

  const payload = {
    query: params.q,
    expandedQueries: variants,
    requestedTypes: params.tipo ?? null,
    requestedSources: params.fonte ?? null,
    requestedProvider: provider,
    total: results.length,
    totalFetched: allFetched.length,
    page: params.page,
    limit: pageSize,
    limitMode: returnAllFetched ? 'all_pages' : params.fonte?.length ? 'per_source' : 'total',
    allPages: returnAllFetched,
    partial: Object.values(providers).some(isProviderFailure) || Boolean(persistence.error),
    providers,
    providerDetails,
    sourceCounts,
    persistence,
    elapsedMs: Math.round(performance.now() - startedAt),
    results,
    cache: { layer: null, hit: false }
  };

  memoryCache.set(key, payload);
  return payload;
}
