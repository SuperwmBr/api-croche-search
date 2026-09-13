// Portado de src/providers/valueserp/valueserp.provider.js (api-croche-search).
// Lógica idêntica - fetch+JSON puro. Recebe apiKey/config como parâmetros
// em vez de importar o env.js do Node.

import { sourceFromUrl } from '../source.js';

function firstString(...values) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() || '';
}

function resultUrl(item) {
  return firstString(item.link, item.url, item.source_link, item.original_url, item.image, item.thumbnail);
}

function imageUrl(item) {
  return firstString(item.image, item.image_url, item.original, item.thumbnail, item.thumbnail_url);
}

function pageItems(body) {
  if (Array.isArray(body?.image_results)) return body.image_results;
  if (Array.isArray(body?.images_results)) return body.images_results;
  if (Array.isArray(body?.results)) return body.results;
  if (Array.isArray(body?.organic_results)) return body.organic_results;
  return [];
}

function nextPage(body, currentPage) {
  const pagination = body?.pagination || {};
  const direct = Number(pagination.next_page ?? pagination.next_page_number);
  if (Number.isInteger(direct) && direct > currentPage) return direct;
  const total = Number(pagination.total_pages ?? pagination.pages);
  if (Number.isInteger(total) && total > currentPage) return currentPage + 1;
  return null;
}

function signature(items) {
  return items.map((item) => `${resultUrl(item)}|${imageUrl(item)}`).join('\n');
}

function requestSignal(signal, timeoutMs) {
  if (!signal) return AbortSignal.timeout(timeoutMs);
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  }
  return signal;
}

function toResult(item, page, index, searchType) {
  const url = resultUrl(item);
  const image = imageUrl(item);
  if (!url && !image) return null;
  const resolvedUrl = url || image;
  return {
    id: `valueserp:${page}:${item.position ?? index + 1}:${btoa(unescape(encodeURIComponent(resolvedUrl))).slice(0, 32)}`,
    externalId: String(item.position ?? `${page}-${index + 1}`),
    type: searchType === 'images' ? 'imagem' : 'artigo',
    origin: sourceFromUrl(resolvedUrl, 'web'),
    provider: 'valueserp',
    engine: item.source || item.domain || 'valueserp',
    title: firstString(item.title, item.name, item.alt, resolvedUrl),
    description: firstString(item.snippet, item.description, item.source),
    url: resolvedUrl,
    image: image || null,
    author: firstString(item.source, item.domain) || null,
    language: 'pt-BR',
    publishedAt: firstString(item.date, item.published_at) || null,
    tags: [],
    rankingSignals: {
      textualRelevance: 0.8,
      sourceQuality: 0.65,
      crochetConfidence: 1,
      freshness: 0.65,
      engagement: 0.25,
      completeness: image ? 0.9 : 0.55
    }
  };
}

export async function searchValueSerp({
  query,
  limit = 20,
  page = 1,
  allPages = true,
  maxPages = 5,
  searchType,
  apiKey,
  baseUrl = 'https://api.valueserp.com/search',
  googleDomain = 'google.com.br',
  gl = 'br',
  hl = 'pt-br',
  timePeriod = 'last_month',
  timeoutMs = 15000,
  signal
}) {
  if (!apiKey) {
    return { configured: false, results: [], diagnostics: { reason: 'VALUESERP_API_KEY ausente' } };
  }

  const pageLimit = Math.max(1, maxPages);
  const results = [];
  const seenPages = new Set();
  let currentPage = Math.max(1, page);
  let pagesCompleted = 0;
  let pagesFailed = 0;
  let hasMore = true;

  while (hasMore && pagesCompleted < pageLimit) {
    const url = new URL(baseUrl);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('search_type', searchType || 'images');
    url.searchParams.set('q', query);
    url.searchParams.set('google_domain', googleDomain);
    url.searchParams.set('gl', gl);
    url.searchParams.set('hl', hl);
    url.searchParams.set('time_period', timePeriod);
    url.searchParams.set('page', String(currentPage));

    let response;
    let body;
    try {
      response = await fetch(url, { headers: { Accept: 'application/json' }, signal: requestSignal(signal, timeoutMs) });
      body = await response.json().catch(() => null);
      if (!response.ok || !body) throw new Error(`ValueSerp request failed (${response.status})`);
    } catch (error) {
      pagesFailed += 1;
      if (pagesCompleted === 0) throw error;
      hasMore = true;
      break;
    }

    const items = pageItems(body);
    const pageSignature = signature(items);
    if (seenPages.has(pageSignature)) {
      hasMore = false;
      break;
    }
    seenPages.add(pageSignature);
    pagesCompleted += 1;
    results.push(...items.map((item, index) => toResult(item, currentPage, index, searchType || 'images')).filter(Boolean));

    if (!allPages || items.length === 0) {
      hasMore = false;
      break;
    }
    const next = nextPage(body, currentPage);
    if (next) currentPage = next;
    else currentPage += 1;
    hasMore = Boolean(items.length && pagesCompleted < pageLimit);
  }

  return {
    configured: true,
    partial: pagesFailed > 0 || (allPages && pagesCompleted >= pageLimit && hasMore),
    results,
    diagnostics: {
      searchType: searchType || 'images',
      pagesRequested: pagesCompleted + pagesFailed,
      pagesCompleted,
      pagesFailed,
      maxPages: pageLimit,
      allPages,
      hasMore,
      rawResults: results.length,
      returnedResults: Math.min(results.length, limit)
    }
  };
}
