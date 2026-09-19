import { queryD1 } from './d1.client.js';
import { detectType } from '../../classification/type.js';

function termosDaConsulta(query) {
  const termos = String(query || '')
    .normalize('NFD')
    .replace(/[\\u0300-\\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((termo) => termo.length >= 3)
    .filter((termo) => !['croche', 'crochet', 'chart', 'diagram'].includes(termo));

  return [...new Set(termos)].slice(0, 16);
}

export async function searchInternal({ query, limit, offset, signal }) {
  const termos = termosDaConsulta(query);
  const termosBusca = termos.length ? termos : [String(query || '').trim().toLowerCase()];
  const condicoes = termosBusca.map(() => "(lower(coalesce(title,'')) LIKE ? OR lower(coalesce(description,'')) LIKE ? OR lower(coalesce(url,'')) LIKE ?)");
  const params = termosBusca.flatMap((termo) => {
    const valor = '%' + termo + '%';
    return [valor, valor, valor];
  });
  params.push(limit, offset);

  const result = await queryD1(
    `SELECT id, type, source, title, description, url, image_url, author, language, published_at, tags_json, source_quality
     FROM SEARCH_RESULTS
     WHERE status = 'active' AND (${condicoes.join(' OR ')})
     ORDER BY source_quality DESC, published_at DESC, id DESC
     LIMIT ? OFFSET ?`,
    params,
    { signal },
  );

  // O SELECT usa apenas colunas essenciais presentes também em instalações D1 antigas.
  // Campos opcionais de catálogo (level/materials_json) ficam com defaults para
  // que uma migração parcial não transforme a busca inteira em HTTP 400.
  // "origin" precisa ser sempre a chave de fonte usada em toda a API
  // (FONTES_BUSCA) — "internal", aqui, sempre, mesmo que a coluna livre
  // SEARCH_RESULTS.source guarde outra coisa (nome do curador/site de
  // origem do conteúdo, não a taxonomia de fontes da busca).
  return result.results.map((row) => ({
    id: `internal:${row.id}`, externalId: String(row.id), type: detectType(row.url, row.type), origin: 'internal', title: row.title,
    description: row.description, url: row.url, image: row.image_url, author: row.author, language: row.language,
    publishedAt: row.published_at, tags: JSON.parse(row.tags_json || '[]'), level: null,
    materials: [], rankingSignals: { textualRelevance: 0.75, sourceQuality: row.source_quality ?? 0.7, crochetConfidence: 1, freshness: 0.5, engagement: 0.3, completeness: 0.7 }
  }));
}
