import { createHash } from 'node:crypto';
import { memoryCache } from '../cache/memory-cache.js';
import { deduplicateResults } from '../deduplication/deduplicate.js';
import { rankResult } from '../ranking/rank.js';
import { expandQuery } from './query-expansion.service.js';
import { searchInternal } from '../providers/d1/d1.provider.js';
import { searchYouTube } from '../providers/youtube/youtube.provider.js';
import { searchSearxng } from '../providers/searxng/searxng.provider.js';
import { searchMeilisearch } from '../providers/meilisearch/meilisearch.provider.js';
import { searchValueSerp } from '../providers/valueserp/valueserp.provider.js';
import { valueSerpRemainingBudget, addValueSerpUsage } from './valueserp-usage.service.js';
import { searchPinterest } from '../providers/pinterest/pinterest.provider.js';
import { persistSearchResults } from '../persistence/search-results.persistence.js';
import { getPinterestCrawlResults, preparePinterestCrawl, claimPinterestCrawl, savePinterestCrawlBatch, failPinterestCrawl } from '../persistence/pinterest-crawl.persistence.js';
import { enqueuePinterestCrawl } from './pinterest-crawl.service.js';
import { buildSourceQueries, categoriesForSource } from '../classification/source.js';
import { env } from '../config/env.js';

const SEARCH_CACHE_VERSION = 'v2';
const cacheKey = (params) => createHash('sha256').update(JSON.stringify({ version: SEARCH_CACHE_VERSION, ...params })).digest('hex');
const timeoutSignal = (ms) => AbortSignal.timeout(ms);
const isProviderFailure = (status) => status === 'error' || status === 'timeout' || status === 'partial';
const CROCHET_CONFIDENCE_THRESHOLD = 0.5;

function rankAndFilter(items, allowedTypes = null, query = '') {
  return deduplicateResults(
    items
      .map((item) => rankResult(item, query, allowedTypes))
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
    maxPages: params.max_paginas || env.valueserpSyncDefaultMaxPages,
    searchType: params.valueserp_tipo || 'images',
    signal: timeoutSignal(env.valueserpTotalTimeoutMs)
  });
}

// Variante usada só dentro do modo 'auto' (params.incluir_valueserp=1),
// pensada para pesquisa manual do usuário: diferente de provedor=valueserp
// (que sempre chama), aqui o teto diário compartilhado com o worker de
// crawl é checado ANTES de cada chamada — se já foi consumido, o ValueSerp
// é pulado nesta busca (sem erro, sem quebrar os demais provedores do
// auto), exatamente como o worker já faz. maxPages fica limitado ao que
// ainda resta do teto, nunca ultrapassando o orçamento diário.
function buildValueSerpAutoCall(params, query) {
  return async () => {
    const remaining = await valueSerpRemainingBudget();
    if (remaining <= 0) {
      return { configured: false, results: [], diagnostics: { reason: 'daily_limit_reached' } };
    }
    // No modo automático, ValueSerp é complementar. Ele não pode prender a
    // resposta inteira por até 120s e causar 504 no proxy quando todas_paginas=1.
    // A busca dedicada (provedor=valueserp) continua usando o limite completo.
    const AUTO_MAX_PAGES = 4;
    const AUTO_TIMEOUT_MS = 15_000;
    const outcome = await searchValueSerp({
      query,
      limit: params.limit,
      page: 1,
      allPages: true,
      maxPages: Math.min(params.max_paginas || env.valueserpSyncDefaultMaxPages, remaining, AUTO_MAX_PAGES),
      searchType: params.valueserp_tipo || 'images',
      signal: timeoutSignal(Math.min(env.valueserpTotalTimeoutMs, AUTO_TIMEOUT_MS))
    });
    const callsMade = Number(outcome.diagnostics?.pagesRequested || 0);
    await addValueSerpUsage(callsMade);
    return outcome;
  };
}

function buildPinterestCall(params, query, crawlContext) {
  const batchLimit = Math.min(params.lote_paginas || env.pinterestBatchMaxPages, env.pinterestBatchMaxPages);
  const maxPages = Math.min(params.max_paginas || batchLimit, batchLimit);
  return () => searchPinterest({
    query,
    limit: params.limit,
    bookmark: crawlContext?.job.nextBookmark || null,
    allPages: params.todas_paginas,
    maxPages,
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

function buildCalls(params, variants, offset, crawlContext = null) {
  const query = variants[0];
  const provider = params.provedor !== 'auto' ? params.provedor : params.provider || 'auto';
  const filters = [
    params.tipo?.length ? `type IN [${params.tipo.map((value) => `"${value}"`).join(',')}]` : null,
    params.idioma ? `language = "${params.idioma}"` : null,
    params.nivel ? `level = "${params.nivel}"` : null
  ].filter(Boolean);

  if (provider === 'valueserp') return { valueserp: buildValueSerpCall(params, query) };
  if (provider === 'scraping') return { scraping: buildPinterestCall(params, query, crawlContext) };
  if (provider === 'mix') {
    return {
      scraping: buildPinterestCall(params, query, crawlContext),
      valueserp: buildValueSerpCall(params, query)
    };
  }

  if (!params.fonte?.length) {
    if (provider === 'searxng') return { searxng: buildSearxngCall(params, query, variants) };
    const auto = {
      internal: () => searchInternal({ query, limit: params.limit, offset, signal: timeoutSignal(env.SEARCH_PROVIDER_TIMEOUT_MS) }).then((results) => ({ configured: env.d1Configured, results })),
      youtube: () => searchYouTube({ query, limit: params.limit, signal: timeoutSignal(env.SEARCH_PROVIDER_TIMEOUT_MS) }),
      searxng: buildSearxngCall(params, query, variants),
      meilisearch: () => searchMeilisearch({ query, limit: params.limit, offset, filters, signal: timeoutSignal(env.MEILISEARCH_TIMEOUT_MS) })
    };
    // Aditivo, não substitui nada acima — só entra com incluir_valueserp=1
    // explícito (pensado pra pesquisa manual; a carga de acervo completo
    // não deve mandar esse parâmetro). Ver buildValueSerpAutoCall.
    if (provider === 'auto' && params.incluir_valueserp) auto.valueserp = buildValueSerpAutoCall(params, query);
    return auto;
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

function crawlSummary(job) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    collectionComplete: job.status === 'complete',
    pagesCompleted: job.pagesCompleted,
    resultsCollected: job.resultsCount,
    statusUrl: `/api/busca/crawls/${job.id}`,
    error: job.error
  };
}

function storedCrawlPayload(params, variants, job, results, startedAt) {
  const ranked = rankAndFilter(results, params.tipo, params.q);
  return {
    query: params.q,
    expandedQueries: variants,
    requestedTypes: params.tipo ?? null,
    requestedSources: params.fonte ?? null,
    requestedProvider: 'scraping',
    total: ranked.length,
    totalFetched: job.resultsCount,
    page: 1,
    limit: params.limit,
    limitMode: 'all_pages',
    allPages: true,
    collectionComplete: job.status === 'complete',
    partial: job.status !== 'complete',
    providers: { scraping: job.status === 'complete' ? 'ok' : 'partial' },
    providerDetails: { scraping: { pagesCompleted: job.pagesCompleted, rawResults: job.resultsCount } },
    sourceCounts: { pinterest: ranked.length },
    persistence: { configured: true, persisted: 0, duplicates: 0 },
    crawl: crawlSummary(job),
    elapsedMs: Math.round(performance.now() - startedAt),
    results: ranked,
    cache: { layer: null, hit: false }
  };
}

export async function search(params) {
  const key = cacheKey(params);
  const cached = memoryCache.get(key);
  if (cached && !cached.partial) return { ...cached, cache: { layer: 'memory', hit: true } };
  // Nunca reaproveitar resultado parcial ou com erro. Isso evita perpetuar
  // um diagnóstico antigo de D1 depois que o schema ou a configuração foi corrigida.
  if (cached) memoryCache.delete(key);

  const startedAt = performance.now();
  const graphFocused = params.tipo?.includes('grafico');
  const variants = expandQuery(params.q, graphFocused ? 8 : 5, { types: params.tipo });
  const pageSize = params.fonte?.length ? params.limit_por_fonte : params.limit;
  const offset = (params.page - 1) * pageSize;
  const provider = params.provedor !== 'auto' ? params.provedor : params.provider || 'auto';
  const batchLimit = Math.min(params.lote_paginas || env.pinterestBatchMaxPages, env.pinterestBatchMaxPages);
  let crawlContext = null;
  let claimedCrawl = null;
  if (provider === 'scraping' && params.todas_paginas && env.d1Configured) {
    crawlContext = await preparePinterestCrawl({ query: variants[0], limit: params.limit, batchPages: batchLimit, maxPages: params.max_paginas });
    claimedCrawl = await claimPinterestCrawl(crawlContext.job.id);
    if (!claimedCrawl?.claimed) {
      const stored = await getPinterestCrawlResults(crawlContext.job.id, { limit: params.limit, offset: 0 });
      const payload = storedCrawlPayload(params, variants, claimedCrawl?.job || crawlContext.job, stored, startedAt);
      if (payload.collectionComplete) memoryCache.set(key, payload);
      return payload;
    }
    crawlContext = claimedCrawl;
  }
  const calls = buildCalls(params, variants, offset, crawlContext);
  const names = Object.keys(calls);
  const settled = await Promise.allSettled(names.map((name) => calls[name]()));
  const providers = {};
  const providerDetails = {};
  const providerCounts = {};
  const grouped = {};

  settled.forEach((outcome, index) => {
    const name = names[index];
    if (outcome.status === 'rejected') {
      providers[name] = outcome.reason?.name === 'TimeoutError' ? 'timeout' : 'error';
      providerDetails[name] = { error: outcome.reason?.message ?? 'provider_failed', rawResults: 0, matchedResults: 0, acceptedResults: 0, returnedResults: 0 };
      providerCounts[name] = { fetched: 0, accepted: 0, returned: 0, discarded: 0 };
      grouped[name] = [];
    } else if (!outcome.value.configured) {
      const diagnostics = outcome.value.diagnostics ?? {};
      const reason = String(diagnostics.reason || '').toLowerCase();
      const status = reason === 'daily_limit_reached'
        ? 'quota_exhausted'
        : reason.includes('api_key') || reason.includes('ausente')
          ? 'not_configured'
          : 'skipped';
      providers[name] = status;
      providerDetails[name] = { ...diagnostics, status };
      providerCounts[name] = { fetched: 0, accepted: 0, returned: 0, discarded: 0 };
      grouped[name] = [];
    } else {
      const fetched = Array.isArray(outcome.value.results) ? outcome.value.results.length : 0;
      providers[name] = outcome.value.partial ? 'partial' : fetched === 0 ? 'empty' : 'ok';
      grouped[name] = rankAndFilter(outcome.value.results, params.tipo, params.q);
      const accepted = grouped[name].length;
      providerDetails[name] = {
        ...(outcome.value.diagnostics ?? {}),
        rawResults: outcome.value.diagnostics?.rawResults ?? fetched,
        matchedResults: outcome.value.diagnostics?.matchedResults ?? accepted,
        acceptedResults: accepted,
        returnedResults: 0,
        hasMore: typeof outcome.value.diagnostics?.hasMore === 'boolean'
          ? outcome.value.diagnostics.hasMore
          : fetched >= (params.fonte?.length ? params.limit_por_fonte : params.limit),
      };
      providerCounts[name] = {
        fetched,
        accepted,
        returned: 0,
        discarded: Math.max(0, fetched - accepted),
      };
    }
  });

  const allFetched = rankAndFilter(Object.values(grouped).flat(), params.tipo, params.q);
  const returnAllFetched = params.todas_paginas && ['scraping', 'valueserp', 'mix'].includes(provider);
  const selectedProviderDetails = providerDetails[provider] || {};
  const providerFailed = Object.values(providers).some(isProviderFailure);
  const providerSkipped = Object.values(providers).some((status) => status === 'quota_exhausted' || status === 'skipped');
  let results;
  let sourceCounts;
  if (params.fonte?.length && provider === 'auto') {
    // Cada fonte contribui com seu teto, mas a resposta final é sempre
    // ordenada globalmente pela relevância da consulta. A ordem de `fonte`
    // não pode decidir qual provedor aparece primeiro.
    const candidatosPorFonte = params.fonte.flatMap((source) => (
      grouped[source] ?? []
    ).slice(0, params.limit_por_fonte));
    results = rankAndFilter(candidatosPorFonte, params.tipo, params.q)
      .slice(0, params.limit_por_fonte * params.fonte.length);
    const returnedKeys = new Set(results.map((item) => item.id || item.url));
    sourceCounts = Object.fromEntries(params.fonte.map((source) => [
      source,
      (grouped[source] ?? []).filter((item) => returnedKeys.has(item.id || item.url)).length
    ]));
  } else if (params.fonte?.length) {
    const selected = allFetched.filter((item) => sourceSelected(item, params.fonte));
    results = returnAllFetched ? selected : selected.slice(0, params.limit_por_fonte * params.fonte.length);
    sourceCounts = Object.fromEntries(params.fonte.map((source) => [source, results.filter((item) => item.origin === source).length]));
  } else {
    results = returnAllFetched ? allFetched : allFetched.slice(0, params.limit);
    sourceCounts = results.reduce((counts, item) => ({ ...counts, [item.origin]: (counts[item.origin] ?? 0) + 1 }), {});
  }

  const returnedKeys = new Set(results.map((item) => item.id || item.url));
  for (const [name, items] of Object.entries(grouped)) {
    const returned = items.filter((item) => returnedKeys.has(item.id || item.url)).length;
    if (providerCounts[name]) providerCounts[name].returned = returned;
    if (providerDetails[name] && typeof providerDetails[name] === 'object') {
      providerDetails[name].returnedResults = returned;
    }
  }

  let persistence = { configured: env.d1Configured, persisted: 0, duplicates: 0, canonicalUrls: [] };
  if (env.d1Configured && allFetched.length) {
    const persistPromise = persistSearchResults(allFetched, { signal: timeoutSignal(env.SEARCH_PERSISTENCE_TIMEOUT_MS) })
      .catch((error) => {
        console.error('[search-persistence]', error?.message || error);
        return { configured: true, persisted: 0, duplicates: 0, canonicalUrls: [], error: error?.message || 'd1_persistence_failed' };
      });
    if (crawlContext?.claimed) {
      // O crawl de Pinterest precisa do resultado (bookmark/lote persistido)
      // pra fechar o batch — aqui o await é necessário.
      persistence = await persistPromise;
    } else {
      // Pesquisa comum (auto/radar_brasil/etc.): persistir é só um efeito
      // colateral de cache pra reaproveitar em buscas futuras, e o front não
      // lê esses números. Bloquear a resposta nisso podia levar SEARCH_PERSISTENCE_TIMEOUT_MS
      // (30s por padrão) e estourar o timeout do front bem antes disso — deixa
      // rodando em segundo plano e responde com o que já temos.
      persistence = { configured: true, persisted: 0, duplicates: 0, canonicalUrls: [], async: true };
    }
  }

  let crawlJob = crawlContext?.job || null;
  if (crawlContext?.claimed) {
    if (providers.scraping === 'error' || providers.scraping === 'timeout') {
      crawlJob = await failPinterestCrawl(crawlContext.job.id, providerDetails.scraping?.error || 'pinterest_batch_failed').catch(() => crawlContext.job);
    } else if (persistence.error) {
      crawlJob = await failPinterestCrawl(crawlContext.job.id, persistence.error).catch(() => crawlContext.job);
    } else {
      crawlJob = await savePinterestCrawlBatch(crawlContext.job.id, {
        nextBookmark: providerDetails.scraping?.nextBookmark,
        hasMore: providerDetails.scraping?.hasMore,
        pagesCompleted: providerDetails.scraping?.pagesCompleted,
        persisted: persistence.persisted,
        canonicalUrls: persistence.canonicalUrls
      }).catch(() => crawlContext.job);
      if (crawlJob?.status === 'queued') enqueuePinterestCrawl();
    }
  }
  const { canonicalUrls: _canonicalUrls, ...publicPersistence } = persistence;
  const publicProviderDetails = Object.fromEntries(Object.entries(providerDetails).map(([name, details]) => {
    if (name !== 'scraping' || !details) return [name, details];
    const { nextBookmark: _nextBookmark, ...safeDetails } = details;
    return [name, safeDetails];
  }));

  const payload = {
    query: params.q,
    expandedQueries: variants,
    requestedTypes: params.tipo ?? null,
    requestedSources: params.fonte ?? null,
    requestedProvider: provider,
    total: results.length,
    totalFetched: allFetched.length,
    hasMore: Object.values(providerDetails).some((details) => details?.hasMore === true),
    nextPage: Object.values(providerDetails).some((details) => details?.hasMore === true) ? params.page + 1 : null,
    page: params.page,
    limit: pageSize,
    limitMode: returnAllFetched ? 'all_pages' : params.fonte?.length ? 'per_source' : 'total',
    allPages: returnAllFetched,
    collectionComplete: crawlJob ? crawlJob.status === 'complete' : !providerFailed && !selectedProviderDetails.hasMore,
    partial: providerFailed || providerSkipped || Boolean(persistence.error),
    providers,
    providerCounts,
    providerDetails: publicProviderDetails,
    sourceCounts,
    persistence: publicPersistence,
    crawl: crawlSummary(crawlJob),
    elapsedMs: Math.round(performance.now() - startedAt),
    results,
    cache: { layer: null, hit: false }
  };

  if (!payload.partial && (!crawlJob || crawlJob.status === 'complete')) memoryCache.set(key, payload);
  return payload;
}
