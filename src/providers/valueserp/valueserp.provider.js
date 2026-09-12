import { sourceFromUrl } from '../../classification/source.js';
import { env } from '../../config/env.js';

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

function requestSignal(signal) {
  if (!signal) return AbortSignal.timeout(env.valueserpTimeoutMs);
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([signal, AbortSignal.timeout(env.valueserpTimeoutMs)]);
  }
  return signal;
}

function toResult(item, page, index, searchType) {
  const url = resultUrl(item);
  const image = imageUrl(item);
  if (!url && !image) return null;
  const resolvedUrl = url || image;
  return {
    id: `valueserp:${page}:${item.position ?? index + 1}:${Buffer.from(resolvedUrl).toString('base64url').slice(0, 32)}`,
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

export async function searchValueSerp({ query, limit = 20, page = 1, allPages = true, maxPages, searchType, signal }) {
  if (!env.valueserpApiKey) {
    return { configured: false, results: [], diagnostics: { reason: 'VALUESERP_API_KEY ausente' } };
  }

  const pageLimit = Math.max(1, maxPages || env.valueserpMaxPages);
  const results = [];
  const seenPages = new Set();
  let currentPage = allPages ? Math.max(1, page) : Math.max(1, page);
  let pagesCompleted = 0;
  let pagesFailed = 0;
  let hasMore = true;

  while (hasMore && pagesCompleted < pageLimit) {
    const url = new URL(env.valueserpBaseUrl);
    url.searchParams.set('api_key', env.valueserpApiKey);
    url.searchParams.set('search_type', searchType || env.valueserpSearchType);
    url.searchParams.set('q', query);
    url.searchParams.set('google_domain', env.valueserpGoogleDomain);
    url.searchParams.set('gl', env.valueserpGl);
    url.searchParams.set('hl', env.valueserpHl);
    url.searchParams.set('time_period', env.valueserpTimePeriod);
    url.searchParams.set('page', String(currentPage));

    let response;
    let body;
    try {
      response = await fetch(url, { headers: { Accept: 'application/json' }, signal: requestSignal(signal) });
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
    results.push(...items.map((item, index) => toResult(item, currentPage, index, searchType || env.valueserpSearchType)).filter(Boolean));

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
      searchType: searchType || env.valueserpSearchType,
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
