// ============================================================================
// croche-search-crawler - arquivo único
// ----------------------------------------------------------------------------
// Worker independente que mantém a base D1 (tutoriais-croche) enriquecida em
// segundo plano via Cron Trigger. Ver README.md nesta mesma pasta pra
// contexto completo (por que existe, deploy, trade-offs).
//
// Tudo num arquivo só por pedido explícito - a lógica foi portada/duplicada
// do repositório principal (../../src/), não importada de lá. Se corrigir
// um bug de dedupe/rank/persistência em ../../src/, replique aqui também.
// ============================================================================

// ---------------------------------------------------------------------------
// Normalização de texto / URL canônica
// (portado de src/normalization/text.js, sem alteração de lógica)
// ---------------------------------------------------------------------------

function normalizeText(value = '') {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function canonicalizeUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith('utm_') || ['gclid', 'fbclid', 'ref'].includes(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    url.pathname = url.pathname.replace(/\/$/, '') || '/';
    return url.toString();
  } catch {
    return value;
  }
}

// sha256 hex via WebCrypto (nativo no runtime do Workers - sem node:crypto).
async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Score de ranking
// (portado de src/ranking/rank.js, sem alteração de lógica)
// ---------------------------------------------------------------------------

const RANK_WEIGHTS = { textual: 0.35, source: 0.20, crochet: 0.20, freshness: 0.10, engagement: 0.10, completeness: 0.05 };
const clamp01 = (n) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

function calculateScore(signals, weights = RANK_WEIGHTS) {
  return Number((
    clamp01(signals.textualRelevance) * weights.textual +
    clamp01(signals.sourceQuality) * weights.source +
    clamp01(signals.crochetConfidence) * weights.crochet +
    clamp01(signals.freshness) * weights.freshness +
    clamp01(signals.engagement) * weights.engagement +
    clamp01(signals.completeness) * weights.completeness
  ).toFixed(6));
}

// ---------------------------------------------------------------------------
// Classificação de fonte por domínio
// (subconjunto de src/classification/source.js - só o que os providers usam)
// ---------------------------------------------------------------------------

function sourceFromUrl(url, fallback = 'web') {
  let host;
  try {
    host = new URL(url).hostname.replace(/^www\./, '').replace(/^m\./, '');
  } catch {
    return fallback;
  }
  if (host === 'youtube.com' || host === 'youtu.be' || host.endsWith('.youtube.com')) return 'youtube';
  if (host === 'instagram.com' || host.endsWith('.instagram.com')) return 'instagram';
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return 'tiktok';
  if (host === 'pin.it' || host === 'pinterest.com' || host.endsWith('.pinterest.com')) return 'pinterest';
  try {
    if (new URL(url).pathname.toLowerCase().endsWith('.pdf')) return 'pdf';
  } catch {}
  return fallback;
}

// ---------------------------------------------------------------------------
// Deduplicação
// (versão JÁ CORRIGIDA de src/deduplication/deduplicate.js - identidade real
// source::externalId tem prioridade sobre canonical_url isolado)
// ---------------------------------------------------------------------------

function deduplicateResults(results) {
  const seen = new Map();
  for (const result of results) {
    const identityKey = result.externalId ? `${result.origin}:${result.externalId}` : null;
    const keys = identityKey
      ? [identityKey]
      : [
          result.url && canonicalizeUrl(result.url),
          result.title?.trim().length > 2 && `${new URL(result.url).hostname}:${normalizeText(result.title)}`
        ].filter(Boolean);
    const existingKey = keys.find((key) => seen.has(key));
    if (!existingKey) {
      const primaryKey = keys[0] ?? result.id;
      seen.set(primaryKey, result);
      for (const key of keys) seen.set(key, result);
      continue;
    }
    const existing = seen.get(existingKey);
    if ((result.score ?? 0) > (existing.score ?? 0)) {
      for (const [key, value] of seen) if (value === existing) seen.set(key, result);
    }
  }
  return [...new Set(seen.values())];
}

const CROCHET_CONFIDENCE_THRESHOLD = 0.5;

function rankAndFilter(items) {
  return deduplicateResults(
    items
      .map((item) => ({ ...item, score: calculateScore(item.rankingSignals ?? {}) }))
      .filter((item) => (item.rankingSignals?.crochetConfidence ?? 0) >= CROCHET_CONFIDENCE_THRESHOLD)
      .sort((a, b) => b.score - a.score)
  );
}

// ---------------------------------------------------------------------------
// Provider: Pinterest (scraping)
// (portado de src/providers/pinterest/pinterest.provider.js - já era
// fetch+JSON puro, parametrizado em vez de importar env.js do Node)
// ---------------------------------------------------------------------------

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

function requestSignal(signal, timeoutMs) {
  if (!signal) return AbortSignal.timeout(timeoutMs);
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  return signal;
}

function toPinterestResult(pin, page, index) {
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
      textualRelevance: 0.8, sourceQuality: 0.65, crochetConfidence: 1,
      freshness: 0.5, engagement: 0.3, completeness: image ? 0.95 : 0.5
    }
  };
}

async function searchPinterest({ query, limit = 20, bookmark = null, allPages = true, maxPages = 3, baseUrl = 'https://www.pinterest.com', timeoutMs = 15000, signal = null }) {
  const results = [];
  const bookmarks = new Set();
  let currentBookmark = bookmark || null;
  let pagesCompleted = 0;
  let hasMore = true;
  let pageError = null;
  const pageLimit = Math.max(1, maxPages);

  while (hasMore && pagesCompleted < pageLimit) {
    console.log(`[pinterest] "${query}" - buscando pagina ${pagesCompleted + 1}/${pageLimit}${currentBookmark ? ' (bookmark)' : ''}`);
    const sourceUrl = `/search/pins/?q=${encodeURIComponent(query)}&rs=typed`;
    const data = {
      options: {
        article: '', appliedProductFilters: '---', price_max: null, price_min: null,
        query, scope: 'pins', auto_correction_disabled: '', top_pin_id: '', filters: '',
        page_size: Math.min(100, Math.max(10, limit)), bookmarks: [currentBookmark]
      },
      context: {}
    };
    const url = `${baseUrl}/resource/BaseSearchResource/get/?source_url=${encodeURIComponent(sourceUrl)}&data=${encodeURIComponent(JSON.stringify(data))}`;
    let response;
    let body;
    try {
      response = await fetch(url, {
        headers: { Accept: 'application/json', 'x-pinterest-pws-handler': 'www/ideas/[interest]/[id].js' },
        signal: requestSignal(signal, timeoutMs)
      });
      body = await response.json().catch(() => null);
      if (!response.ok || !body) throw new Error(`Pinterest scraping failed (${response.status})`);
    } catch (error) {
      console.error(`[pinterest] "${query}" - pagina ${pagesCompleted + 1} falhou: ${error?.message || error}`);
      if (pagesCompleted === 0) throw error;
      pageError = error?.message || 'pinterest_page_failed';
      hasMore = true;
      break;
    }

    const resource = body.resource_response || body.resource || {};
    const items = resource.data?.results || body.data?.results || [];
    pagesCompleted += 1;
    results.push(...items.map((item, index) => toPinterestResult(item, pagesCompleted, index)).filter(Boolean));
    console.log(`[pinterest] "${query}" - pagina ${pagesCompleted} ok - ${items.length} itens brutos`);
    const nextBookmark = resource.bookmark || body.bookmark || null;
    if (!allPages || !nextBookmark || bookmarks.has(nextBookmark) || nextBookmark === currentBookmark || items.length === 0) {
      hasMore = false;
    } else {
      bookmarks.add(nextBookmark);
      currentBookmark = nextBookmark;
    }
  }

  console.log(`[pinterest] "${query}" - finalizado: ${pagesCompleted} pagina(s), ${results.length} resultado(s), hasMore=${hasMore}`);
  return {
    configured: true,
    partial: hasMore || Boolean(pageError),
    results,
    diagnostics: { pagesRequested: pagesCompleted, pagesCompleted, maxPages: pageLimit, allPages, hasMore, nextBookmark: hasMore ? currentBookmark : null, error: pageError, rawResults: results.length }
  };
}

// ---------------------------------------------------------------------------
// Provider: ValueSerp
// (portado de src/providers/valueserp/valueserp.provider.js)
// ---------------------------------------------------------------------------

function firstString(...values) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() || '';
}

function valueSerpResultUrl(item) {
  return firstString(item.link, item.url, item.source_link, item.original_url, item.image, item.thumbnail);
}

function valueSerpImageUrl(item) {
  return firstString(item.image, item.image_url, item.original, item.thumbnail, item.thumbnail_url);
}

function valueSerpPageItems(body) {
  if (Array.isArray(body?.image_results)) return body.image_results;
  if (Array.isArray(body?.images_results)) return body.images_results;
  if (Array.isArray(body?.results)) return body.results;
  if (Array.isArray(body?.organic_results)) return body.organic_results;
  return [];
}

function valueSerpNextPage(body, currentPage) {
  const pagination = body?.pagination || {};
  const direct = Number(pagination.next_page ?? pagination.next_page_number);
  if (Number.isInteger(direct) && direct > currentPage) return direct;
  const total = Number(pagination.total_pages ?? pagination.pages);
  if (Number.isInteger(total) && total > currentPage) return currentPage + 1;
  return null;
}

function valueSerpSignature(items) {
  return items.map((item) => `${valueSerpResultUrl(item)}|${valueSerpImageUrl(item)}`).join('\n');
}

function toValueSerpResult(item, page, index, searchType) {
  const url = valueSerpResultUrl(item);
  const image = valueSerpImageUrl(item);
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
      textualRelevance: 0.8, sourceQuality: 0.65, crochetConfidence: 1,
      freshness: 0.65, engagement: 0.25, completeness: image ? 0.9 : 0.55
    }
  };
}

async function searchValueSerp({ query, limit = 20, page = 1, allPages = true, maxPages = 5, searchType, apiKey, baseUrl = 'https://api.valueserp.com/search', googleDomain = 'google.com.br', gl = 'br', hl = 'pt-br', timePeriod = 'last_month', timeoutMs = 15000, signal = null }) {
  if (!apiKey) {
    console.warn(`[valueserp] "${query}" - VALUESERP_API_KEY ausente, pulando este provider`);
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
    console.log(`[valueserp] "${query}" - buscando pagina ${currentPage} (${pagesCompleted + 1}/${pageLimit})`);
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
      console.error(`[valueserp] "${query}" - pagina ${currentPage} falhou: ${error?.message || error}`);
      pagesFailed += 1;
      if (pagesCompleted === 0) throw error;
      hasMore = true;
      break;
    }

    const items = valueSerpPageItems(body);
    const pageSignature = valueSerpSignature(items);
    if (seenPages.has(pageSignature)) {
      console.log(`[valueserp] "${query}" - pagina ${currentPage} repetida (sem itens novos), parando`);
      hasMore = false;
      break;
    }
    seenPages.add(pageSignature);
    pagesCompleted += 1;
    results.push(...items.map((item, index) => toValueSerpResult(item, currentPage, index, searchType || 'images')).filter(Boolean));
    console.log(`[valueserp] "${query}" - pagina ${currentPage} ok - ${items.length} itens brutos`);

    if (!allPages || items.length === 0) { hasMore = false; break; }
    const next = valueSerpNextPage(body, currentPage);
    currentPage = next || currentPage + 1;
    hasMore = Boolean(items.length && pagesCompleted < pageLimit);
  }

  console.log(`[valueserp] "${query}" - finalizado: ${pagesCompleted} pagina(s) ok, ${pagesFailed} falhou(aram), ${results.length} resultado(s)`);
  return {
    configured: true,
    partial: pagesFailed > 0 || (allPages && pagesCompleted >= pageLimit && hasMore),
    results,
    diagnostics: { searchType: searchType || 'images', pagesRequested: pagesCompleted + pagesFailed, pagesCompleted, pagesFailed, maxPages: pageLimit, allPages, hasMore, rawResults: results.length, returnedResults: Math.min(results.length, limit) }
  };
}

// ---------------------------------------------------------------------------
// Derivação das queries a manter atualizadas
// (a partir de títulos/tags já existentes em SEARCH_RESULTS - SEARCH_QUERIES
// existe no schema mas nada grava nela hoje, ver README.md)
// ---------------------------------------------------------------------------

const QUERY_STOPWORDS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'com', 'para', 'por', 'em', 'no', 'na', 'nos', 'nas',
  'a', 'o', 'as', 'os', 'e', 'ou', 'um', 'uma', 'que', 'como',
  'the', 'and', 'for', 'with', 'to', 'of', 'in', 'on', 'is', 'are',
  'free', 'pattern', 'patterns', 'ideas', 'idea'
]);

const CROCHET_MARKERS = ['croche', 'crochet', 'amigurumi', 'trico', 'tricot', 'grafico'];

const SEED_QUERIES = [
  'grafico de croche', 'receita de croche', 'ponto de croche', 'amigurumi croche',
  'croche para iniciantes', 'blusa de croche', 'vestido de croche', 'tapete de croche',
  'bolsa de croche', 'sandalia de croche'
];

function tokenizeQuery(text) {
  return normalizeText(text).split(' ').filter((word) => word.length > 2 && !QUERY_STOPWORDS.has(word));
}

function ngrams(tokens, n) {
  const out = [];
  for (let i = 0; i <= tokens.length - n; i += 1) out.push(tokens.slice(i, i + n).join(' '));
  return out;
}

async function deriveTrackedQueries(db, limit = 10) {
  const freq = new Map();
  try {
    const { results } = await db.prepare(
      `SELECT title, tags_json FROM SEARCH_RESULTS WHERE status = 'active' ORDER BY indexed_at DESC LIMIT 500`
    ).all();
    console.log(`[queries] lidas ${results?.length ?? 0} linha(s) de SEARCH_RESULTS pra derivar termos`);

    for (const row of results ?? []) {
      const tokens = tokenizeQuery(row.title || '');
      for (const phrase of [...ngrams(tokens, 2), ...ngrams(tokens, 3)]) {
        if (!CROCHET_MARKERS.some((marker) => phrase.includes(marker))) continue;
        freq.set(phrase, (freq.get(phrase) || 0) + 1);
      }
      try {
        const tags = JSON.parse(row.tags_json || '[]');
        for (const tag of tags) {
          const normalizedTag = normalizeText(String(tag));
          if (normalizedTag.length <= 2) continue;
          if (!CROCHET_MARKERS.some((marker) => normalizedTag.includes(marker))) continue;
          freq.set(normalizedTag, (freq.get(normalizedTag) || 0) + 2);
        }
      } catch {}
    }
  } catch (error) {
    console.error('[queries] falha ao ler SEARCH_RESULTS para derivar queries', error?.message || error);
  }

  const derived = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([phrase]) => phrase);
  const combined = [...new Set([...derived, ...SEED_QUERIES])];
  const final = combined.slice(0, limit);
  console.log(`[queries] derivadas: ${derived.length} termo(s) reais - lista final (${final.length}/${limit}): ${JSON.stringify(final)}`);
  return final;
}

// ---------------------------------------------------------------------------
// Persistência no D1 via binding nativo (db.batch)
// (mesma correção de dedupe aplicada hoje em rows() da API + 1 única viagem
// de rede em vez de dezenas sequenciais via REST API)
// ---------------------------------------------------------------------------

const D1_MAX_BOUND_PARAMETERS = 100;
const URL_REGISTRY_PARAMETERS_PER_ROW = 5;
const SEARCH_RESULT_PARAMETERS_PER_ROW = 15;
const URL_REGISTRY_BATCH_SIZE = Math.floor(D1_MAX_BOUND_PARAMETERS / URL_REGISTRY_PARAMETERS_PER_ROW);
const SEARCH_RESULT_BATCH_SIZE = Math.floor(D1_MAX_BOUND_PARAMETERS / SEARCH_RESULT_PARAMETERS_PER_ROW);

let schemaReady = false;

async function ensureSchema(db) {
  if (schemaReady) return;
  console.log('[persist] verificando/criando schema SEARCH_URLS (primeira vez nesta instancia)');
  await db.prepare(`CREATE TABLE IF NOT EXISTS SEARCH_URLS (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    canonical_url TEXT NOT NULL UNIQUE,
    original_url TEXT NOT NULL,
    image_url TEXT,
    provider TEXT,
    source TEXT,
    first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS IDX_SEARCH_URLS_SOURCE ON SEARCH_URLS(source, last_seen_at DESC)').run();
  schemaReady = true;
  console.log('[persist] schema OK');
}

async function toPersistenceRows(results) {
  const mapped = await Promise.all(results.map(async (item) => {
    const url = String(item.url || '').trim();
    if (!url) return null;
    const canonicalUrl = canonicalizeUrl(url);
    const title = String(item.title || url).slice(0, 500);
    const tags = Array.isArray(item.tags) ? item.tags : [];
    const imageUrl = item.image ? String(item.image).slice(0, 4000) : null;
    const externalId = item.externalId ? String(item.externalId).slice(0, 500) : null;
    const source = String(item.origin || 'web').slice(0, 40);
    return {
      url, canonicalUrl, imageUrl,
      provider: String(item.provider || item.engine || item.origin || 'unknown').slice(0, 80),
      source, externalId,
      dedupeKey: externalId ? `${source}::${externalId}` : `${canonicalUrl}::${imageUrl || ''}`,
      type: String(item.type || 'artigo').slice(0, 40),
      title,
      description: item.description ? String(item.description).slice(0, 5000) : null,
      author: item.author ? String(item.author).slice(0, 500) : null,
      language: item.language ? String(item.language).slice(0, 20) : null,
      publishedAt: item.publishedAt ? String(item.publishedAt).slice(0, 80) : null,
      tagsJson: JSON.stringify(tags.slice(0, 50)),
      metadataJson: JSON.stringify({ provider: item.provider || null, engine: item.engine || null }),
      titleHash: await sha256Hex(normalizeText(title)),
      sourceQuality: Number.isFinite(item.rankingSignals?.sourceQuality) ? item.rankingSignals.sourceQuality : 0.5
    };
  }));
  const filtered = mapped.filter(Boolean);
  return [...new Map(filtered.map((item) => [item.dedupeKey, item])).values()];
}

function chunk(items, size) {
  const out = [];
  for (let start = 0; start < items.length; start += size) out.push(items.slice(start, start + size));
  return out;
}

async function persistSearchResults(db, results) {
  const items = await toPersistenceRows(results);
  if (!items.length) {
    console.log('[persist] nada pra persistir (0 itens apos dedupe)');
    return { persisted: 0, duplicates: 0 };
  }
  console.log(`[persist] gravando ${items.length} item(ns) unico(s) em ${chunk(items, URL_REGISTRY_BATCH_SIZE).length} lote(s) de URL + ${chunk(items, SEARCH_RESULT_BATCH_SIZE).length} lote(s) de resultado - 1 unica viagem de rede (db.batch)`);
  await ensureSchema(db);

  const urlStatements = chunk(items, URL_REGISTRY_BATCH_SIZE).map((batch) => {
    const values = batch.map(() => "(?,?,?,?,?,datetime('now'),datetime('now'))").join(',');
    const params = batch.flatMap((item) => [item.canonicalUrl, item.url, item.imageUrl, item.provider, item.source]);
    return db.prepare(`INSERT INTO SEARCH_URLS (canonical_url,original_url,image_url,provider,source,first_seen_at,last_seen_at)
      VALUES ${values}
      ON CONFLICT(canonical_url) DO UPDATE SET
        original_url=excluded.original_url,
        image_url=COALESCE(excluded.image_url,SEARCH_URLS.image_url),
        provider=excluded.provider,
        source=excluded.source,
        last_seen_at=datetime('now')`).bind(...params);
  });

  const resultStatements = chunk(items, SEARCH_RESULT_BATCH_SIZE).map((batch) => {
    const values = batch.map(() => "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',datetime('now'),datetime('now'))").join(',');
    const params = batch.flatMap((item) => [
      item.externalId, item.type, item.source, item.title, item.description, item.url,
      item.canonicalUrl, item.imageUrl, item.author, item.language, item.publishedAt,
      item.tagsJson, item.metadataJson, item.titleHash, item.sourceQuality
    ]);
    return db.prepare(`INSERT OR IGNORE INTO SEARCH_RESULTS
      (external_id,type,source,title,description,url,canonical_url,image_url,author,language,published_at,tags_json,metadata_json,title_hash,source_quality,status,indexed_at,updated_at)
      VALUES ${values}`).bind(...params);
  });

  const batchResults = await db.batch([...urlStatements, ...resultStatements]);
  const resultOutcomes = batchResults.slice(urlStatements.length);
  const inserted = resultOutcomes.reduce((sum, outcome) => sum + Number(outcome.meta?.changes || 0), 0);
  const duplicates = Math.max(0, results.length - inserted);
  console.log(`[persist] gravado: ${inserted} nova(s) linha(s) em SEARCH_RESULTS, ${duplicates} duplicata(s)/ja existente(s)`);

  return { persisted: inserted, duplicates };
}

// ---------------------------------------------------------------------------
// Ciclo de crawl e handlers do Worker (cron + endpoint manual)
// ---------------------------------------------------------------------------

async function crawlQuery(env, query) {
  const dailyLimit = Number(env.VALUESERP_DAILY_LIMIT || DEFAULT_VALUESERP_DAILY_LIMIT);
  const usedToday = await getValueSerpUsageToday(env.DB);
  const remaining = Math.max(0, dailyLimit - usedToday);
  const valueSerpAllowed = remaining > 0;
  // Em vez de só permitir/bloquear a query inteira, o maxPages desta chamada
  // fica limitado ao que ainda resta do teto diario - garante um corte
  // exato (nunca ultrapassa dailyLimit), em vez de arriscar passar até
  // VALUESERP_MAX_PAGES-1 chamadas do teto na query que cruza a linha.
  const valueSerpMaxPages = Math.min(Number(env.VALUESERP_MAX_PAGES || 2), remaining);
  if (!valueSerpAllowed) {
    console.warn(`[valueserp] teto diario atingido (${usedToday}/${dailyLimit}) - pulando ValueSerp para "${query}", so Pinterest`);
  }

  console.log(`[crawl] "${query}" - disparando pinterest${valueSerpAllowed ? ` + valueserp (max ${valueSerpMaxPages} pagina(s) restante(s) do teto)` : ' (valueserp pulado - teto diario)'} em paralelo`);
  const [pinterest, valueserp] = await Promise.allSettled([
    searchPinterest({
      query, limit: 100, allPages: true,
      maxPages: Number(env.PINTEREST_MAX_PAGES || 2),
      baseUrl: env.PINTEREST_BASE_URL || 'https://www.pinterest.com',
      timeoutMs: Number(env.PINTEREST_TIMEOUT_MS || 10000)
    }),
    valueSerpAllowed
      ? searchValueSerp({
          query, allPages: true,
          maxPages: valueSerpMaxPages,
          searchType: env.VALUESERP_SEARCH_TYPE || 'images',
          apiKey: env.VALUESERP_API_KEY,
          googleDomain: env.VALUESERP_GOOGLE_DOMAIN || 'google.com.br',
          gl: env.VALUESERP_GL || 'br',
          hl: env.VALUESERP_HL || 'pt-br',
          timePeriod: env.VALUESERP_TIME_PERIOD || 'last_month',
          timeoutMs: Number(env.VALUESERP_TIMEOUT_MS || 10000)
        })
      : Promise.resolve({ configured: false, results: [], diagnostics: { reason: 'daily_limit_reached', pagesRequested: 0 } })
  ]);

  const collected = [];
  const diagnostics = {};
  if (pinterest.status === 'fulfilled') { collected.push(...pinterest.value.results); diagnostics.scraping = pinterest.value.diagnostics; }
  else diagnostics.scraping = { error: pinterest.reason?.message || 'pinterest_failed' };
  if (valueserp.status === 'fulfilled') {
    collected.push(...valueserp.value.results);
    diagnostics.valueserp = valueserp.value.diagnostics ?? { configured: valueserp.value.configured };
    const callsMade = Number(valueserp.value.diagnostics?.pagesRequested || 0);
    await addValueSerpUsage(env.DB, callsMade);
    if (callsMade) console.log(`[valueserp] consumo registrado: +${callsMade} chamada(s) - total hoje: ${usedToday + callsMade}/${dailyLimit}`);
  } else {
    diagnostics.valueserp = { error: valueserp.reason?.message || 'valueserp_failed' };
  }

  const ranked = rankAndFilter(collected);
  console.log(`[crawl] "${query}" - coletados ${collected.length} bruto(s) -> ${ranked.length} apos rank/dedupe`);
  return { ranked, diagnostics };
}

// ---------------------------------------------------------------------------
// Fila de queries persistida no D1 - UMA query processada por invocação
// ---------------------------------------------------------------------------
// Por que isso existe: um teste real em produção mostrou que o Cloudflare
// mata tarefas de ctx.waitUntil() que não terminam em ~30s após a resposta
// ("waitUntil() tasks did not complete within the allowed time... and have
// been cancelled") - processar N queries sequenciais num só disparo (cron
// ou /run) SEMPRE vai esbarrar nisso mais cedo ou mais tarde, não importa
// o orçamento de tempo interno que a gente tente impor. A correção de
// verdade é nunca fazer uma invocação carregar mais que ~1 query de
// trabalho, e deixar o PRÓPRIO cron (repetindo a cada poucos minutos)
// ser o mecanismo que avança a fila ao longo do tempo.

const DEFAULT_TRACKED_QUERIES_LIMIT = 5;
const MAX_TRACKED_QUERIES_LIMIT = 20; // teto de segurança, mesmo se a var de ambiente vier absurda
const DEFAULT_VALUESERP_DAILY_LIMIT = 200;

let queueSchemaReady = false;

async function ensureQueueSchema(db) {
  if (queueSchemaReady) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS CRAWL_QUEUE (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_at TEXT
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS VALUESERP_USAGE (
    day TEXT PRIMARY KEY,
    calls INTEGER NOT NULL DEFAULT 0
  )`).run();
  queueSchemaReady = true;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

async function getValueSerpUsageToday(db) {
  const { results } = await db.prepare('SELECT calls FROM VALUESERP_USAGE WHERE day = ?').bind(todayKey()).all();
  return Number(results?.[0]?.calls || 0);
}

async function addValueSerpUsage(db, calls) {
  if (!calls) return;
  await db.prepare(`INSERT INTO VALUESERP_USAGE (day, calls) VALUES (?, ?)
    ON CONFLICT(day) DO UPDATE SET calls = calls + excluded.calls`).bind(todayKey(), calls).run();
}

async function refillQueue(env) {
  const limit = Math.min(Number(env.TRACKED_QUERIES_LIMIT || DEFAULT_TRACKED_QUERIES_LIMIT), MAX_TRACKED_QUERIES_LIMIT);
  const queries = await deriveTrackedQueries(env.DB, limit);
  const statements = queries.map((query) => env.DB.prepare('INSERT INTO CRAWL_QUEUE (query, status) VALUES (?, \'pending\')').bind(query));
  if (statements.length) await env.DB.batch(statements);
  console.log(`[queue] fila recarregada com ${queries.length} query(s): ${JSON.stringify(queries)}`);
  return queries;
}

// Processa UM item da fila (o mais antigo pendente). Se a fila estiver
// vazia, recarrega com um novo lote derivado e processa o primeiro.
// Retorna null se não havia nada a fazer (ex: sem VALUESERP_API_KEY e
// deriveTrackedQueries não achou nada, o que não deveria acontecer por
// causa da lista-semente, mas é uma guarda de qualquer forma).
async function processNextInQueue(env) {
  await ensureQueueSchema(env.DB);

  let { results: pending } = await env.DB.prepare(
    `SELECT id, query FROM CRAWL_QUEUE WHERE status = 'pending' ORDER BY id ASC LIMIT 1`
  ).all();

  if (!pending?.length) {
    console.log('[queue] vazia - recarregando com novo lote derivado de SEARCH_RESULTS');
    await refillQueue(env);
    ({ results: pending } = await env.DB.prepare(
      `SELECT id, query FROM CRAWL_QUEUE WHERE status = 'pending' ORDER BY id ASC LIMIT 1`
    ).all());
  }

  if (!pending?.length) {
    console.warn('[queue] nada pra processar mesmo apos recarregar (inesperado)');
    return null;
  }

  const { id, query } = pending[0];
  console.log(`[queue] processando item #${id}: "${query}"`);

  try {
    const { ranked, diagnostics } = await crawlQuery(env, query);
    const persistence = await persistSearchResults(env.DB, ranked);
    await env.DB.prepare(`UPDATE CRAWL_QUEUE SET status = 'done', processed_at = datetime('now') WHERE id = ?`).bind(id).run();
    console.log(`[queue] item #${id} "${query}" concluido - fetched=${ranked.length} persisted=${persistence.persisted} duplicates=${persistence.duplicates}`);
    return { id, query, fetched: ranked.length, ...persistence, diagnostics };
  } catch (error) {
    await env.DB.prepare(`UPDATE CRAWL_QUEUE SET status = 'failed', processed_at = datetime('now') WHERE id = ?`).bind(id).run();
    console.error(`[queue] item #${id} "${query}" falhou - ${error?.message || error}`);
    return { id, query, error: error?.message || 'crawl_failed' };
  }
}

// Loga em TODA invocação - confirma na hora, sem adivinhar, se o código
// que está rodando é o que você acabou de colar. Bumped a cada mudança.
const WORKER_VERSION = 'v4-teto-diario-valueserp-2026-09-13';

export default {
  async scheduled(event, env, ctx) {
    console.log(`[worker] versao=${WORKER_VERSION} - cron disparado (cron="${event.cron}")`);
    ctx.waitUntil(processNextInQueue(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/run') {
      const providedKey = request.headers.get('x-admin-key') || url.searchParams.get('key');
      if (!env.WORKER_ADMIN_KEY || providedKey !== env.WORKER_ADMIN_KEY) {
        console.warn('[worker] /run chamado com chave invalida ou ausente');
        return new Response('unauthorized', { status: 401 });
      }
      console.log(`[worker] versao=${WORKER_VERSION} - /run disparado manualmente`);
      // Processa UM item da fila e ESPERA terminar antes de responder -
      // diferente da versão anterior, não depende de waitUntil sobreviver
      // além da resposta. Uma unica query (2 paginas por provider, no
      // maximo) termina em segundos, bem dentro do tempo que uma resposta
      // HTTP normal aguenta.
      const result = await processNextInQueue(env);
      return new Response(JSON.stringify({ version: WORKER_VERSION, processed: result }, null, 2), {
        headers: { 'content-type': 'application/json' }
      });
    }
    if (url.pathname === '/queue') {
      await ensureQueueSchema(env.DB);
      const { results } = await env.DB.prepare(
        `SELECT status, COUNT(*) as total FROM CRAWL_QUEUE GROUP BY status`
      ).all();
      const usedToday = await getValueSerpUsageToday(env.DB);
      const dailyLimit = Number(env.VALUESERP_DAILY_LIMIT || DEFAULT_VALUESERP_DAILY_LIMIT);
      return new Response(JSON.stringify({
        queue: results,
        valueserp: { usedToday, dailyLimit, day: todayKey() }
      }, null, 2), { headers: { 'content-type': 'application/json' } });
    }
    return new Response(`croche-search-crawler worker ok - versao=${WORKER_VERSION}`, { status: 200 });
  }
};
