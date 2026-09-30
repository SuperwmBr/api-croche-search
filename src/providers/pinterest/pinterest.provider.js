import { sourceFromUrl } from '../../classification/source.js';
import { detectType } from '../../classification/type.js';
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

function firstText(...values) {
  return values
    .map((value) => String(value ?? '').replace(/\s+/g, ' ').trim())
    .find(Boolean) || '';
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
  const title = firstText(
    pin?.title,
    pin?.grid_title,
    pin?.rich_summary?.title,
    pin?.seo_data?.title,
    pin?.auto_alt_text,
    pin?.description
  );
  const description = firstText(
    pin?.description,
    pin?.rich_summary?.description,
    pin?.seo_data?.description,
    pin?.auto_alt_text,
    pin?.grid_title
  );
  return {
    id: `pinterest:${pin?.id || `${page}-${index + 1}`}`,
    externalId: String(pin?.id || `${page}-${index + 1}`),
    // Usa título/descrição para reconhecer gráficos sem depender de um
    // classificador visual externo. A Groq continua disponível como opção.
    type: detectType(url, 'imagem', {
      title,
      description
    }),
    origin: sourceFromUrl(url, 'pinterest'),
    provider: 'pinterest_scraping',
    engine: 'pinterest',
    title: title || 'Pin de crochê',
    description,
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

export async function searchPinterest({ query, queries = [], limit = 20, bookmark = null, allPages = true, maxPages, collectionMode = false, signal }) {
  const queryVariants = [...new Set([query, ...queries]
    .map((value) => String(value || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean))].slice(0, 4);
  if (queryVariants.length > 1 && !bookmark) {
    const results = [];
    const seen = new Set();
    const diagnostics = [];
    const totalPageBudget = collectionMode ? Math.max(1, maxPages || env.pinterestMaxPages) : queryVariants.length;
    let pagesUsed = 0;
    for (let index = 0; index < queryVariants.length; index += 1) {
      const variant = queryVariants[index];
      // Buscas comuns preservam uma página por variante. A coleta completa
      // distribui um orçamento total de até seis páginas entre as variantes,
      // priorizando a consulta original e sem ultrapassar o teto pedido.
      const pagesLeft = Math.max(1, totalPageBudget - pagesUsed);
      const variantsLeft = queryVariants.length - index;
      const pageBudget = collectionMode && allPages
        ? Math.max(1, Math.min(pagesLeft - variantsLeft + 1, Math.ceil(pagesLeft / variantsLeft)))
        : 1;
      try {
        const output = await searchPinterest({
          query: variant,
          limit,
          allPages: Boolean(collectionMode && allPages),
          maxPages: pageBudget,
          signal
        });
        diagnostics.push(output.diagnostics);
        pagesUsed += Number(output.diagnostics?.pagesCompleted || 0);
        for (const item of output.results) {
          const key = item.externalId || item.url;
          if (seen.has(key)) continue;
          seen.add(key);
          results.push(item);
        }
      } catch (error) {
        diagnostics.push({ pagesRequested: 0, pagesCompleted: 0, error: error?.message || 'pinterest_query_failed' });
      }
    }
    return {
      configured: true,
      partial: diagnostics.some((item) => Boolean(item.error) || Boolean(item.hasMore)),
      results,
      diagnostics: {
        pagesRequested: diagnostics.reduce((sum, item) => sum + item.pagesRequested, 0),
        pagesCompleted: diagnostics.reduce((sum, item) => sum + item.pagesCompleted, 0),
        maxPages: collectionMode ? totalPageBudget : 1,
        allPages: Boolean(collectionMode && allPages),
        hasMore: diagnostics.some((item) => Boolean(item.hasMore)),
        nextBookmark: diagnostics.find((item) => item.nextBookmark)?.nextBookmark || null,
        error: diagnostics.find((item) => item.error)?.error || null,
        rawResults: results.length,
        queriesRequested: queryVariants.length,
        queriesCompleted: diagnostics.filter((item) => item.pagesCompleted > 0).length
      }
    };
  }

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
