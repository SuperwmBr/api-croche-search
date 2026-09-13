import { deriveTrackedQueries } from './queries.js';
import { searchPinterest } from './providers/pinterest.js';
import { searchValueSerp } from './providers/valueserp.js';
import { deduplicateResults } from './dedupe.js';
import { calculateScore } from './rank.js';
import { persistSearchResults } from './persist.js';

const CROCHET_CONFIDENCE_THRESHOLD = 0.5;

function rankAndFilter(items) {
  return deduplicateResults(
    items
      .map((item) => ({ ...item, score: calculateScore(item.rankingSignals ?? {}) }))
      .filter((item) => (item.rankingSignals?.crochetConfidence ?? 0) >= CROCHET_CONFIDENCE_THRESHOLD)
      .sort((a, b) => b.score - a.score)
  );
}

async function crawlQuery(env, query) {
  const [pinterest, valueserp] = await Promise.allSettled([
    searchPinterest({
      query,
      limit: 100,
      allPages: true,
      maxPages: Number(env.PINTEREST_MAX_PAGES || 3),
      baseUrl: env.PINTEREST_BASE_URL || 'https://www.pinterest.com',
      timeoutMs: Number(env.PINTEREST_TIMEOUT_MS || 15000)
    }),
    searchValueSerp({
      query,
      allPages: true,
      maxPages: Number(env.VALUESERP_MAX_PAGES || 5),
      searchType: env.VALUESERP_SEARCH_TYPE || 'images',
      apiKey: env.VALUESERP_API_KEY,
      googleDomain: env.VALUESERP_GOOGLE_DOMAIN || 'google.com.br',
      gl: env.VALUESERP_GL || 'br',
      hl: env.VALUESERP_HL || 'pt-br',
      timePeriod: env.VALUESERP_TIME_PERIOD || 'last_month',
      timeoutMs: Number(env.VALUESERP_TIMEOUT_MS || 15000)
    })
  ]);

  const collected = [];
  const diagnostics = {};
  if (pinterest.status === 'fulfilled') {
    collected.push(...pinterest.value.results);
    diagnostics.scraping = pinterest.value.diagnostics;
  } else {
    diagnostics.scraping = { error: pinterest.reason?.message || 'pinterest_failed' };
  }
  if (valueserp.status === 'fulfilled') {
    collected.push(...valueserp.value.results);
    diagnostics.valueserp = valueserp.value.diagnostics ?? { configured: valueserp.value.configured };
  } else {
    diagnostics.valueserp = { error: valueserp.reason?.message || 'valueserp_failed' };
  }

  return { ranked: rankAndFilter(collected), diagnostics };
}

export async function runCrawlCycle(env) {
  const limit = Number(env.TRACKED_QUERIES_LIMIT || 10);
  const queries = await deriveTrackedQueries(env.DB, limit);
  const summary = [];

  // Sequencial de propósito: evita disparar N buscas Pinterest+ValueSerp
  // simultâneas (risco de rate limit) - isso é trabalho de fundo via cron,
  // não uma requisição de usuário esperando resposta, então não há pressão
  // de latência aqui.
  for (const query of queries) {
    try {
      const { ranked, diagnostics } = await crawlQuery(env, query);
      const persistence = await persistSearchResults(env.DB, ranked);
      summary.push({ query, fetched: ranked.length, ...persistence, diagnostics });
    } catch (error) {
      summary.push({ query, error: error?.message || 'crawl_failed' });
    }
  }
  return summary;
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runCrawlCycle(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/run') {
      if (!env.WORKER_ADMIN_KEY || request.headers.get('x-admin-key') !== env.WORKER_ADMIN_KEY) {
        return new Response('unauthorized', { status: 401 });
      }
      const summary = await runCrawlCycle(env);
      return new Response(JSON.stringify(summary, null, 2), { headers: { 'content-type': 'application/json' } });
    }
    return new Response('croche-search-crawler worker ok', { status: 200 });
  }
};
