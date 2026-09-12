import { sourceFromUrl } from '../../classification/source.js';
import { env } from '../../config/env.js';

function imageFromPin(pin) {
  return pin?.images?.orig?.url
    || pin?.images?.['736x']?.url
    || pin?.images?.['564x']?.url
    || pin?.images?.['600x315']?.url
    || '';
}

function pinUrl(pin, image) {
  return pin?.link || (pin?.id ? `https://www.pinterest.com/pin/${pin.id}/` : image);
}

function requestSignal(signal) {
  if (!signal) return AbortSignal.timeout(env.pinterestTimeoutMs);
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([signal, AbortSignal.timeout(env.pinterestTimeoutMs)]);
  }
  return signal;
}

function toResult(pin, page, index) {
  const image = imageFromPin(pin);
  const url = pinUrl(pin, image);
  if (!url) return null;
  return {
    id: `pinterest:${pin?.id || `${page}-${index + 1}`}`,
    externalId: String(pin?.id || `${page}-${index + 1}`),
    type: 'imagem',
    origin: sourceFromUrl(url, 'pinterest'),
    provider: 'pinterest_scraping',
    engine: 'pinterest',
    title: pin?.title || pin?.grid_title || pin?.description || 'Pin de crochê',
    description: pin?.description || pin?.grid_title || '',
    url,
    image: image || null,
    author: pin?.pinner?.full_name || pin?.pinner?.username || null,
    language: 'pt-BR',
    publishedAt: pin?.created_at || null,
    tags: [],
    rankingSignals: {
      textualRelevance: 0.8,
      sourceQuality: 0.65,
      crochetConfidence: 1,
      freshness: 0.5,
      engagement: 0.3,
      completeness: image ? 0.95 : 0.5
    }
  };
}

export async function searchPinterest({ query, limit = 20, bookmark = null, allPages = true, maxPages, signal }) {
  const results = [];
  const bookmarks = new Set();
  let currentBookmark = bookmark || null;
  let pagesCompleted = 0;
  let hasMore = true;
  let pageError = null;
  const pageLimit = Math.max(1, maxPages || env.pinterestMaxPages);

  while (hasMore && pagesCompleted < pageLimit) {
    const sourceUrl = `/search/pins/?q=${encodeURIComponent(query)}&rs=typed`;
    const data = {
      options: {
        article: '', appliedProductFilters: '---', price_max: null, price_min: null,
        query, scope: 'pins', auto_correction_disabled: '', top_pin_id: '', filters: '',
        page_size: Math.min(100, Math.max(10, limit)), bookmarks: [currentBookmark]
      },
      context: {}
    };
    const url = `${env.pinterestBaseUrl}/resource/BaseSearchResource/get/?source_url=${encodeURIComponent(sourceUrl)}&data=${encodeURIComponent(JSON.stringify(data))}`;
    let response;
    let body;
    try {
      response = await fetch(url, {
        headers: { Accept: 'application/json', 'x-pinterest-pws-handler': 'www/ideas/[interest]/[id].js' },
        signal: requestSignal(signal)
      });
      body = await response.json().catch(() => null);
      if (!response.ok || !body) throw new Error(`Pinterest scraping failed (${response.status})`);
    } catch (error) {
      if (pagesCompleted === 0) throw error;
      pageError = error?.message || 'pinterest_page_failed';
      hasMore = true;
      break;
    }

    const resource = body.resource_response || body.resource || {};
    const items = resource.data?.results || body.data?.results || [];
    pagesCompleted += 1;
    results.push(...items.map((item, index) => toResult(item, pagesCompleted, index)).filter(Boolean));
    const nextBookmark = resource.bookmark || body.bookmark || null;
    if (!allPages || !nextBookmark || bookmarks.has(nextBookmark) || nextBookmark === currentBookmark || items.length === 0) {
      hasMore = false;
    } else {
      bookmarks.add(nextBookmark);
      currentBookmark = nextBookmark;
    }
  }

  return {
    configured: true,
    partial: hasMore || Boolean(pageError),
    results,
    diagnostics: {
      pagesRequested: pagesCompleted,
      pagesCompleted,
      maxPages: pageLimit,
      allPages,
      hasMore,
      nextBookmark: hasMore ? currentBookmark : null,
      error: pageError,
      rawResults: results.length
    }
  };
}
