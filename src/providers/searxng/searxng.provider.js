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

async function settleRequests(requests) {
  const settled = await Promise.allSettled(requests.map((request) => fetchPage(request)));
  return {
    bodies: settled.filter((outcome) => outcome.status === 'fulfilled').map((outcome) => outcome.value),
    failures: settled.filter((outcome) => outcome.status === 'rejected').map((outcome) => outcome.reason)
  };
}

function collectMatches(bodies, source) {
  const seen = new Set();
  const rawResults = bodies.flatMap((body) => body.results ?? []);
  const matched = rawResults.filter((item) => {
    if (!item?.url || seen.has(item.url)) return false;
    seen.add(item.url);
    return source === 'all' || matchesSource(item.url, source);
  });
  return { rawResults, matched };
}

export async function searchSearxng({ query, queries, limit, targetResults = limit, safeSearch, signal, source = 'all', categories = 'general', pages = 1 }) {
  const queryVariants = Array.isArray(queries) && queries.length ? queries : [query];
  const primaryQuery = queryVariants[0];
  const pageNumbers = Array.from({ length: Math.max(1, Math.min(pages, 3)) }, (_, index) => index + 1);
  const primary = await settleRequests(pageNumbers.map((page) => ({ query: primaryQuery, safeSearch, categories, page, signal })));
  const allBodies = [...primary.bodies];
  const allFailures = [...primary.failures];
  let { matched } = collectMatches(allBodies, source);
  let fallbackUsed = false;

  if (matched.length < targetResults && queryVariants.length > 1 && !signal?.aborted) {
    fallbackUsed = true;
    const fallback = await settleRequests(queryVariants.slice(1).map((fallbackQuery) => ({ query: fallbackQuery, safeSearch, categories, page: 1, signal })));
    allBodies.push(...fallback.bodies);
    allFailures.push(...fallback.failures);
    ({ matched } = collectMatches(allBodies, source));
  }

  if (!allBodies.length) throw allFailures[0] ?? new Error('SearXNG did not return any page');

  const { rawResults } = collectMatches(allBodies, source);
  const raw = matched.slice(0, limit);
  const requestsCompleted = allBodies.length;
  const requestsFailed = allFailures.length;
  const requestsRequested = requestsCompleted + requestsFailed;

  return {
    configured: true,
    partial: requestsFailed > 0,
    diagnostics: {
      pagesRequested: requestsRequested,
      pagesCompleted: requestsCompleted,
      pagesFailed: requestsFailed,
      queriesRequested: fallbackUsed ? queryVariants.length : 1,
      fallbackUsed,
      queryVariants: fallbackUsed ? queryVariants : [primaryQuery],
      rawResults: rawResults.length,
      matchedResults: matched.length
    },
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
