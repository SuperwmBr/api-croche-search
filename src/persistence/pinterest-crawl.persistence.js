import { createHash } from 'node:crypto';
import { queryD1 } from '../providers/d1/d1.client.js';
import { env } from '../config/env.js';

let schemaReady = false;
const LINK_BATCH_SIZE = 40;

async function ensureSchema(signal) {
  if (schemaReady || !env.d1Configured) return;
  await queryD1(`CREATE TABLE IF NOT EXISTS SEARCH_CRAWL_JOBS (
    id TEXT PRIMARY KEY,
    crawl_key TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL,
    query TEXT NOT NULL,
    params_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'queued',
    next_bookmark TEXT,
    pages_completed INTEGER NOT NULL DEFAULT 0,
    results_count INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT
  )`, [], { signal });
  await queryD1(`CREATE TABLE IF NOT EXISTS SEARCH_CRAWL_ITEMS (
    crawl_id TEXT NOT NULL REFERENCES SEARCH_CRAWL_JOBS(id) ON DELETE CASCADE,
    canonical_url TEXT NOT NULL REFERENCES SEARCH_RESULTS(canonical_url) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(crawl_id, canonical_url)
  )`, [], { signal });
  await queryD1('CREATE INDEX IF NOT EXISTS IDX_SEARCH_CRAWL_JOBS_STATUS ON SEARCH_CRAWL_JOBS(status, updated_at)', [], { signal });
  await queryD1('CREATE INDEX IF NOT EXISTS IDX_SEARCH_CRAWL_ITEMS_CRAWL ON SEARCH_CRAWL_ITEMS(crawl_id, created_at)', [], { signal });
  schemaReady = true;
}

function parseJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    crawlKey: row.crawl_key,
    provider: row.provider,
    query: row.query,
    params: JSON.parse(row.params_json || '{}'),
    status: row.status,
    nextBookmark: row.next_bookmark || null,
    pagesCompleted: Number(row.pages_completed || 0),
    resultsCount: Number(row.results_count || 0),
    attempts: Number(row.attempts || 0),
    error: row.error_message || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || null
  };
}

const selectJob = async (id, signal) => {
  const result = await queryD1('SELECT * FROM SEARCH_CRAWL_JOBS WHERE id = ?', [id], { signal });
  return parseJob(result.results[0]);
};

function crawlKey({ query, limit, batchPages, maxPages }) {
  return createHash('sha256').update(JSON.stringify({ provider: 'scraping', query, limit, batchPages, maxPages: maxPages || null })).digest('hex');
}

export async function preparePinterestCrawl({ query, limit, batchPages, maxPages, signal }) {
  if (!env.d1Configured) return null;
  await ensureSchema(signal);
  const key = crawlKey({ query, limit, batchPages, maxPages });
  const existing = await queryD1('SELECT * FROM SEARCH_CRAWL_JOBS WHERE crawl_key = ?', [key], { signal });
  if (existing.results[0]) return { job: parseJob(existing.results[0]), claimed: false };

  const id = `pinterest_${key.slice(0, 32)}`;
  await queryD1(`INSERT OR IGNORE INTO SEARCH_CRAWL_JOBS
    (id, crawl_key, provider, query, params_json, status)
    VALUES (?, ?, 'scraping', ?, ?, 'queued')`, [id, key, query, JSON.stringify({ limit, batchPages, maxPages: maxPages || null })], { signal });
  const job = await selectJob(id, signal);
  return { job, claimed: false };
}

export async function claimPinterestCrawl(id, { signal } = {}) {
  if (!env.d1Configured) return null;
  await ensureSchema(signal);
  const job = await selectJob(id, signal);
  if (!job) return null;
  if (job.status === 'complete') return { job, claimed: false };
  const stale = job.status === 'running' && Date.parse(job.updatedAt) < Date.now() - env.pinterestCrawlStaleMs;
  if (job.status === 'running' && !stale) return { job, claimed: false };
  await queryD1(`UPDATE SEARCH_CRAWL_JOBS
    SET status = 'running', attempts = attempts + 1, error_message = NULL, updated_at = datetime('now')
    WHERE id = ?`, [id], { signal });
  return { job: await selectJob(id, signal), claimed: true };
}

export async function savePinterestCrawlBatch(id, { nextBookmark, hasMore, pagesCompleted, persisted, canonicalUrls = [], error = null, signal } = {}) {
  if (!env.d1Configured) return null;
  await ensureSchema(signal);
  if (canonicalUrls.length) {
    for (let start = 0; start < canonicalUrls.length; start += LINK_BATCH_SIZE) {
      const batch = canonicalUrls.slice(start, start + LINK_BATCH_SIZE);
      const values = batch.map(() => '(?, ?)').join(',');
      await queryD1(`INSERT OR IGNORE INTO SEARCH_CRAWL_ITEMS (crawl_id, canonical_url) VALUES ${values}`, batch.flatMap((url) => [id, url]), { signal });
    }
  }
  const current = await selectJob(id, signal);
  if (!current) return null;
  const totalPages = current.pagesCompleted + Number(pagesCompleted || 0);
  const linkedCount = await queryD1('SELECT COUNT(*) AS count FROM SEARCH_CRAWL_ITEMS WHERE crawl_id = ?', [id], { signal });
  const totalResults = Number(linkedCount.results[0]?.count || current.resultsCount || persisted || 0);
  const maxPages = Number(current.params.maxPages || 0);
  const reachedMax = maxPages > 0 && totalPages >= maxPages;
  const complete = !hasMore || reachedMax;
  const status = complete ? 'complete' : error ? 'queued' : 'queued';
  await queryD1(`UPDATE SEARCH_CRAWL_JOBS SET
    status = ?, next_bookmark = ?, pages_completed = ?, results_count = ?, error_message = ?,
    updated_at = datetime('now'), completed_at = CASE WHEN ? = 'complete' THEN datetime('now') ELSE completed_at END
    WHERE id = ?`, [status, complete ? null : nextBookmark, totalPages, totalResults, error, status, id], { signal });
  return selectJob(id, signal);
}

export async function failPinterestCrawl(id, error, { signal } = {}) {
  if (!env.d1Configured) return null;
  await ensureSchema(signal);
  await queryD1(`UPDATE SEARCH_CRAWL_JOBS SET status = 'queued', error_message = ?, updated_at = datetime('now') WHERE id = ?`, [String(error || 'crawl_failed').slice(0, 1000), id], { signal });
  return selectJob(id, signal);
}

export async function listRunnablePinterestCrawls({ signal } = {}) {
  if (!env.d1Configured) return [];
  await ensureSchema(signal);
  const result = await queryD1(`SELECT * FROM SEARCH_CRAWL_JOBS
    WHERE status = 'queued' OR (status = 'running' AND updated_at < datetime('now', ?))
    ORDER BY updated_at ASC LIMIT 5`, [`-${Math.ceil(env.pinterestCrawlStaleMs / 1000)} seconds`], { signal });
  return result.results.map(parseJob);
}

export async function getPinterestCrawl(id, { signal } = {}) {
  if (!env.d1Configured) return null;
  await ensureSchema(signal);
  return selectJob(id, signal);
}

export async function getPinterestCrawlResults(id, { limit = 100, offset = 0, signal } = {}) {
  if (!env.d1Configured) return [];
  await ensureSchema(signal);
  const result = await queryD1(`SELECT r.id, r.external_id, r.type, r.source, r.title, r.description, r.url,
    r.image_url, r.author, r.language, r.published_at, r.tags_json, r.metadata_json, r.source_quality
    FROM SEARCH_CRAWL_ITEMS i JOIN SEARCH_RESULTS r ON r.canonical_url = i.canonical_url
    WHERE i.crawl_id = ? ORDER BY r.source_quality DESC, r.published_at DESC LIMIT ? OFFSET ?`, [id, limit, offset], { signal });
  return result.results.map((row) => ({
    id: `pinterest:${row.external_id || row.id}`,
    externalId: row.external_id || String(row.id),
    type: row.type,
    origin: row.source || 'pinterest',
    provider: JSON.parse(row.metadata_json || '{}').provider || 'pinterest_scraping',
    engine: JSON.parse(row.metadata_json || '{}').engine || 'pinterest',
    title: row.title,
    description: row.description || '',
    url: row.url,
    image: row.image_url,
    author: row.author,
    language: row.language,
    publishedAt: row.published_at,
    tags: JSON.parse(row.tags_json || '[]'),
    rankingSignals: { sourceQuality: row.source_quality ?? 0.65, crochetConfidence: 1, textualRelevance: 0.8, freshness: 0.5, engagement: 0.3, completeness: row.image_url ? 0.95 : 0.5 }
  }));
}
