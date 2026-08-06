import { queryD1 } from './d1.client.js';
import { detectType } from '../../classification/type.js';

export async function searchInternal({ query, limit, offset, signal }) {
  const result = await queryD1(`SELECT id, type, source, title, description, url, image_url, author, language, published_at, tags_json, level, materials_json, source_quality FROM SEARCH_RESULTS WHERE status = 'active' AND (title LIKE ? OR description LIKE ?) ORDER BY source_quality DESC, published_at DESC LIMIT ? OFFSET ?`, [`%${query}%`, `%${query}%`, limit, offset], { signal });
  return result.results.map((row) => ({
    id: `internal:${row.id}`, externalId: String(row.id), type: detectType(row.url, row.type), origin: row.source, title: row.title,
    description: row.description, url: row.url, image: row.image_url, author: row.author, language: row.language,
    publishedAt: row.published_at, tags: JSON.parse(row.tags_json || '[]'), level: row.level,
    materials: JSON.parse(row.materials_json || '[]'), rankingSignals: { textualRelevance: 0.75, sourceQuality: row.source_quality ?? 0.7, crochetConfidence: 1, freshness: 0.5, engagement: 0.3, completeness: 0.7 }
  }));
}
