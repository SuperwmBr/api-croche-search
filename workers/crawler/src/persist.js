// Persistência via binding nativo de D1 (env.DB), não via REST API.
// Diferença crucial em relação a src/persistence/search-results.persistence.js
// (api-croche-search): lá, cada lote é um fetch() HTTPS separado pra
// api.cloudflare.com - aqui, TODOS os lotes (registro de URLs + resultados)
// viram um único db.batch([...]), executado numa única viagem de rede.
// É isso que elimina o "aborted due to timeout" que vimos na API hoje.

import { canonicalizeUrl, normalizeText, sha256Hex } from './text.js';

const D1_MAX_BOUND_PARAMETERS = 100;
const URL_REGISTRY_PARAMETERS_PER_ROW = 5;
const SEARCH_RESULT_PARAMETERS_PER_ROW = 15;
const URL_REGISTRY_BATCH_SIZE = Math.floor(D1_MAX_BOUND_PARAMETERS / URL_REGISTRY_PARAMETERS_PER_ROW);
const SEARCH_RESULT_BATCH_SIZE = Math.floor(D1_MAX_BOUND_PARAMETERS / SEARCH_RESULT_PARAMETERS_PER_ROW);

let schemaReady = false;

async function ensureSchema(db) {
  if (schemaReady) return;
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
}

// Mesma correção de dedupe aplicada hoje em rows() de
// search-results.persistence.js: identidade real (source::externalId)
// tem prioridade sobre canonical_url isolado, pra não colapsar pins
// distintos que compartilham o mesmo artigo (ex: listicles).
async function rows(results) {
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
      url,
      canonicalUrl,
      imageUrl,
      provider: String(item.provider || item.engine || item.origin || 'unknown').slice(0, 80),
      source,
      externalId,
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

export async function persistSearchResults(db, results) {
  const items = await rows(results);
  if (!items.length) return { persisted: 0, duplicates: 0 };
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

  const resultBatches = chunk(items, SEARCH_RESULT_BATCH_SIZE);
  const resultStatements = resultBatches.map((batch) => {
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

  // Uma única viagem de rede pra todos os lotes (registro de URLs + resultados),
  // independente de quantos itens vieram - diferente da API, que faz um
  // fetch() HTTPS por lote.
  const batchResults = await db.batch([...urlStatements, ...resultStatements]);
  const resultOutcomes = batchResults.slice(urlStatements.length);
  const inserted = resultOutcomes.reduce((sum, outcome) => sum + Number(outcome.meta?.changes || 0), 0);

  return { persisted: inserted, duplicates: Math.max(0, results.length - inserted) };
}
