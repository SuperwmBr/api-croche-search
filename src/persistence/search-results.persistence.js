import { createHash } from 'node:crypto';
import { queryD1 } from '../providers/d1/d1.client.js';
import { canonicalizeUrl, normalizeText } from '../normalization/text.js';

let urlsSchemaReady = false;
const D1_MAX_BOUND_PARAMETERS = 100;
const URL_REGISTRY_PARAMETERS_PER_ROW = 5;
const SEARCH_RESULT_PARAMETERS_PER_ROW = 15;
const URL_REGISTRY_BATCH_SIZE = Math.floor(D1_MAX_BOUND_PARAMETERS / URL_REGISTRY_PARAMETERS_PER_ROW);
const SEARCH_RESULT_BATCH_SIZE = Math.floor(D1_MAX_BOUND_PARAMETERS / SEARCH_RESULT_PARAMETERS_PER_ROW);

async function ensureUrlsSchema(signal) {
  if (urlsSchemaReady) return;
  await queryD1(`CREATE TABLE IF NOT EXISTS SEARCH_URLS (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    canonical_url TEXT NOT NULL UNIQUE,
    original_url TEXT NOT NULL,
    image_url TEXT,
    provider TEXT,
    source TEXT,
    first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`, [], { signal });
  await queryD1('CREATE INDEX IF NOT EXISTS IDX_SEARCH_URLS_SOURCE ON SEARCH_URLS(source, last_seen_at DESC)', [], { signal });
  urlsSchemaReady = true;
}

function rows(results) {
  const mapped = results.map((item) => {
    const url = String(item.url || '').trim();
    if (!url) return null;
    const canonicalUrl = canonicalizeUrl(url);
    const title = String(item.title || url).slice(0, 500);
    const tags = Array.isArray(item.tags) ? item.tags : [];
    return {
      url,
      canonicalUrl,
      imageUrl: item.image ? String(item.image).slice(0, 4000) : null,
      provider: String(item.provider || item.engine || item.origin || 'unknown').slice(0, 80),
      source: String(item.origin || 'web').slice(0, 40),
      externalId: item.externalId ? String(item.externalId).slice(0, 500) : null,
      type: String(item.type || 'artigo').slice(0, 40),
      title,
      description: item.description ? String(item.description).slice(0, 5000) : null,
      author: item.author ? String(item.author).slice(0, 500) : null,
      language: item.language ? String(item.language).slice(0, 20) : null,
      publishedAt: item.publishedAt ? String(item.publishedAt).slice(0, 80) : null,
      tagsJson: JSON.stringify(tags.slice(0, 50)),
      metadataJson: JSON.stringify({ provider: item.provider || null, engine: item.engine || null }),
      titleHash: createHash('sha256').update(normalizeText(title)).digest('hex'),
      sourceQuality: Number.isFinite(item.rankingSignals?.sourceQuality) ? item.rankingSignals.sourceQuality : 0.5
    };
  }).filter(Boolean);
  return [...new Map(mapped.map((item) => [item.canonicalUrl, item])).values()];
}

async function insertUrlRegistry(items, signal) {
  for (let start = 0; start < items.length; start += URL_REGISTRY_BATCH_SIZE) {
    const batch = items.slice(start, start + URL_REGISTRY_BATCH_SIZE);
    const values = batch.map(() => "(?,?,?,?,?,datetime('now'),datetime('now'))").join(',');
    const params = batch.flatMap((item) => [item.canonicalUrl, item.url, item.imageUrl, item.provider, item.source]);
    await queryD1(`INSERT INTO SEARCH_URLS (canonical_url,original_url,image_url,provider,source,first_seen_at,last_seen_at)
      VALUES ${values}
      ON CONFLICT(canonical_url) DO UPDATE SET
        original_url=excluded.original_url,
        image_url=COALESCE(excluded.image_url,SEARCH_URLS.image_url),
        provider=excluded.provider,
        source=excluded.source,
        last_seen_at=datetime('now')`, params, { signal });
  }
}

async function insertResults(items, signal) {
  let inserted = 0;
  for (let start = 0; start < items.length; start += SEARCH_RESULT_BATCH_SIZE) {
    const batch = items.slice(start, start + SEARCH_RESULT_BATCH_SIZE);
    const values = batch.map(() => "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',datetime('now'),datetime('now'))").join(',');
    const params = batch.flatMap((item) => [
      item.externalId, item.type, item.source, item.title, item.description, item.url,
      item.canonicalUrl, item.imageUrl, item.author, item.language, item.publishedAt,
      item.tagsJson, item.metadataJson, item.titleHash, item.sourceQuality
    ]);
    const result = await queryD1(`INSERT OR IGNORE INTO SEARCH_RESULTS
      (external_id,type,source,title,description,url,canonical_url,image_url,author,language,published_at,tags_json,metadata_json,title_hash,source_quality,status,indexed_at,updated_at)
      VALUES ${values}`, params, { signal });
    inserted += Number(result.meta?.changes || 0);
  }
  return inserted;
}

export async function persistSearchResults(results, { signal } = {}) {
  const items = rows(results);
  if (!items.length) return { configured: true, persisted: 0, duplicates: 0, canonicalUrls: [] };
  await ensureUrlsSchema(signal);
  await insertUrlRegistry(items, signal);
  const inserted = await insertResults(items, signal);
  return { configured: true, persisted: inserted, duplicates: Math.max(0, results.length - inserted), canonicalUrls: items.map((item) => item.canonicalUrl) };
}
