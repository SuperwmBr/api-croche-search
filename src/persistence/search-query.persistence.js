import { createHash } from 'node:crypto';
import { queryD1 } from '../providers/d1/d1.client.js';
import { normalizeText } from '../normalization/text.js';

let schemaReady = false;

async function ensureSchema(signal) {
  if (schemaReady) return;
  await queryD1(`CREATE TABLE IF NOT EXISTS SEARCH_QUERIES (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query_original TEXT NOT NULL,
    query_normalized TEXT NOT NULL,
    query_hash TEXT NOT NULL,
    filters_json TEXT NOT NULL DEFAULT '{}',
    result_count INTEGER NOT NULL DEFAULT 0,
    partial INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER,
    ip_hash TEXT,
    user_agent_summary TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`, [], { signal });
  await queryD1('CREATE INDEX IF NOT EXISTS IDX_SEARCH_QUERIES_HASH_DATE ON SEARCH_QUERIES(query_hash, created_at DESC)', [], { signal });
  schemaReady = true;
}

export async function recordSearchQuery({ query, filters = {}, resultCount = 0, partial = false, durationMs = null, signal } = {}) {
  const original = String(query || '').trim().slice(0, 500);
  const normalized = normalizeText(original).replace(/\s+/g, ' ').trim();
  if (!original || !normalized) return { configured: false };

  await ensureSchema(signal);
  const queryHash = createHash('sha256').update(normalized).digest('hex');
  return queryD1(`INSERT INTO SEARCH_QUERIES
    (query_original, query_normalized, query_hash, filters_json, result_count, partial, duration_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?)`, [
    original,
    normalized,
    queryHash,
    JSON.stringify(filters),
    Math.max(0, Number(resultCount) || 0),
    partial ? 1 : 0,
    Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : null
  ], { signal });
}
