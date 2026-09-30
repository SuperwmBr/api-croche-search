import { randomUUID } from 'node:crypto';
import { queryD1 } from '../providers/d1/d1.client.js';

let schemaReady = false;
const MAX_BIND_PARAMETERS = 100;
const ITEM_BATCH_SIZE = Math.floor(MAX_BIND_PARAMETERS / 4);

async function ensureSchema(signal) {
  if (schemaReady) return;
  await queryD1(`CREATE TABLE IF NOT EXISTS SEARCH_COLLECTION_JOBS (
    id TEXT PRIMARY KEY,
    query TEXT NOT NULL,
    params_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    providers_json TEXT NOT NULL DEFAULT '{}',
    results_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT
  )`, [], { signal });
  await queryD1(`CREATE TABLE IF NOT EXISTS SEARCH_COLLECTION_ITEMS (
    collection_id TEXT NOT NULL REFERENCES SEARCH_COLLECTION_JOBS(id) ON DELETE CASCADE,
    canonical_url TEXT NOT NULL,
    score REAL NOT NULL DEFAULT 0,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(collection_id, canonical_url)
  )`, [], { signal });
  await queryD1('CREATE INDEX IF NOT EXISTS IDX_SEARCH_COLLECTION_ITEMS_PAGE ON SEARCH_COLLECTION_ITEMS(collection_id, score DESC, canonical_url)', [], { signal });
  await queryD1('CREATE INDEX IF NOT EXISTS IDX_SEARCH_COLLECTION_JOBS_STATUS ON SEARCH_COLLECTION_JOBS(status, updated_at)', [], { signal });
  schemaReady = true;
}

function parseJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    query: row.query,
    params: JSON.parse(row.params_json || '{}'),
    status: row.status,
    providers: JSON.parse(row.providers_json || '{}'),
    resultsCount: Number(row.results_count || 0),
    error: row.error_message || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || null
  };
}

async function selectJob(id, signal) {
  const result = await queryD1('SELECT * FROM SEARCH_COLLECTION_JOBS WHERE id = ?', [id], { signal });
  return parseJob(result.results[0]);
}

export async function createSearchCollection(params, { signal } = {}) {
  await ensureSchema(signal);
  const id = `search_${randomUUID()}`;
  const safeParams = {
    q: params.q,
    tipo: params.tipo || null,
    fonte: params.fonte || null,
    idioma: params.idioma || null,
    nivel: params.nivel || null,
    page: params.page || 1,
    limit: params.limit || 250,
    safe_search: params.safe_search || '1',
    provedor: 'auto',
    todas_paginas: true,
    max_paginas: 6,
    incluir_valueserp: Boolean(params.incluir_valueserp),
    somente_graficos: Boolean(params.somente_graficos),
    identificar_graficos: Boolean(params.identificar_graficos)
  };
  await queryD1(`INSERT INTO SEARCH_COLLECTION_JOBS (id, query, params_json, status)
    VALUES (?, ?, ?, 'queued')`, [id, params.q, JSON.stringify(safeParams)], { signal });
  return selectJob(id, signal);
}

export async function claimSearchCollection(id, { signal } = {}) {
  await ensureSchema(signal);
  const job = await selectJob(id, signal);
  if (!job || job.status === 'complete') return { job, claimed: false };
  const stale = job.status === 'running' && Date.parse(job.updatedAt) < Date.now() - 300000;
  if (job.status === 'running' && !stale) return { job, claimed: false };
  await queryD1(`UPDATE SEARCH_COLLECTION_JOBS SET status = 'running', error_message = NULL, updated_at = datetime('now') WHERE id = ?`, [id], { signal });
  return { job: await selectJob(id, signal), claimed: true };
}

export async function saveSearchCollection(id, output, { signal } = {}) {
  await ensureSchema(signal);
  const items = output.results || [];
  for (let start = 0; start < items.length; start += ITEM_BATCH_SIZE) {
    const batch = items.slice(start, start + ITEM_BATCH_SIZE).filter((item) => item?.url);
    if (!batch.length) continue;
    const values = batch.map(() => '(?,?,?,?,CURRENT_TIMESTAMP)').join(',');
    const params = batch.flatMap((item) => [
      id,
      String(item.url).slice(0, 4000),
      Number.isFinite(item.score) ? item.score : Number(item.rankingSignals?.textualRelevance || 0),
      JSON.stringify(item)
    ]);
    await queryD1(`INSERT INTO SEARCH_COLLECTION_ITEMS (collection_id, canonical_url, score, result_json, created_at)
      VALUES ${values}
      ON CONFLICT(collection_id, canonical_url) DO UPDATE SET
        score = MAX(SEARCH_COLLECTION_ITEMS.score, excluded.score),
        result_json = CASE WHEN excluded.score >= SEARCH_COLLECTION_ITEMS.score THEN excluded.result_json ELSE SEARCH_COLLECTION_ITEMS.result_json END`, params, { signal });
  }
  const providers = output.providers || {};
  const details = output.providerDetails || {};
  const result = await queryD1('SELECT COUNT(*) AS count FROM SEARCH_COLLECTION_ITEMS WHERE collection_id = ?', [id], { signal });
  const count = Number(result.results[0]?.count || 0);
  const partial = Boolean(output.partial) || Object.values(providers).some((state) => ['partial', 'timeout', 'error', 'pending', 'quota_exhausted'].includes(state)) || Object.values(details).some((provider) => provider?.hasMore === true);
  const status = partial ? 'partial' : 'complete';
  await queryD1(`UPDATE SEARCH_COLLECTION_JOBS SET status = ?, providers_json = ?, results_count = ?,
    error_message = NULL, updated_at = datetime('now'), completed_at = datetime('now') WHERE id = ?`, [status, JSON.stringify({ providers, details, partial }), count, id], { signal });
  return selectJob(id, signal);
}

export async function failSearchCollection(id, error, { signal } = {}) {
  await ensureSchema(signal);
  await queryD1(`UPDATE SEARCH_COLLECTION_JOBS SET status = 'error', error_message = ?, updated_at = datetime('now'), completed_at = datetime('now') WHERE id = ?`, [String(error || 'search_collection_failed').slice(0, 1000), id], { signal });
}

export async function listSearchCollections({ signal } = {}) {
  await ensureSchema(signal);
  const result = await queryD1(`SELECT * FROM SEARCH_COLLECTION_JOBS
    WHERE status = 'queued' OR (status = 'running' AND updated_at < datetime('now', '-300 seconds'))
    ORDER BY updated_at ASC LIMIT 5`, [], { signal });
  return result.results.map(parseJob);
}

export async function getSearchCollection(id, { page = 1, limit = 100, signal } = {}) {
  await ensureSchema(signal);
  const job = await selectJob(id, signal);
  if (!job) return null;
  const offset = (page - 1) * limit;
  const result = await queryD1(`SELECT result_json FROM SEARCH_COLLECTION_ITEMS
    WHERE collection_id = ? ORDER BY score DESC, canonical_url ASC LIMIT ? OFFSET ?`, [id, limit, offset], { signal });
  return {
    collection: {
      id: job.id,
      query: job.query,
      status: job.status,
      complete: ['complete', 'partial', 'error'].includes(job.status),
      partial: job.status === 'partial' || job.status === 'error',
      providers: job.providers,
      total: job.resultsCount,
      error: job.error,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt
    },
    page,
    limit,
    hasMore: offset + result.results.length < job.resultsCount,
    results: result.results.map((row) => JSON.parse(row.result_json))
  };
}
