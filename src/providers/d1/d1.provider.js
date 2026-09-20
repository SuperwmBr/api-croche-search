import { queryD1 } from './d1.client.js';
import { detectType } from '../../classification/type.js';

let ftsReady = false;
let ftsUnavailable = false;

function termosDaConsulta(query) {
  const termos = String(query || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((termo) => termo.length >= 3)
    .filter((termo) => !['croche', 'crochet', 'chart', 'diagram', 'para', 'com', 'em', 'de', 'da', 'do'].includes(termo));

  return [...new Set(termos)].slice(0, 16);
}

function escaparFts(termo) {
  return '"' + String(termo).replace(/"/g, '""') + '"';
}

function mapearResultados(rows, textualRelevance = 0.75) {
  return rows.map((row) => ({
    id: `internal:${row.id}`,
    externalId: String(row.id),
    type: detectType(row.url, row.type),
    origin: 'internal',
    title: row.title,
    description: row.description,
    url: row.url,
    image: row.image_url,
    author: row.author,
    language: row.language,
    publishedAt: row.published_at,
    tags: JSON.parse(row.tags_json || '[]'),
    level: null,
    materials: [],
    rankingSignals: {
      textualRelevance,
      sourceQuality: 0.7,
      crochetConfidence: 1,
      freshness: 0.5,
      engagement: 0.3,
      completeness: 0.7
    }
  }));
}

async function garantirFts(signal) {
  if (ftsReady || ftsUnavailable) return !ftsUnavailable;

  try {
    await queryD1(`CREATE VIRTUAL TABLE IF NOT EXISTS SEARCH_RESULTS_FTS USING fts5(
      title,
      description,
      tags_json,
      author,
      content='SEARCH_RESULTS',
      content_rowid='id',
      tokenize='unicode61 remove_diacritics 2'
    )`, [], { signal });

    await queryD1(`CREATE TRIGGER IF NOT EXISTS SEARCH_RESULTS_FTS_AI
      AFTER INSERT ON SEARCH_RESULTS BEGIN
        INSERT INTO SEARCH_RESULTS_FTS(rowid,title,description,tags_json,author)
        VALUES (new.id,new.title,new.description,new.tags_json,new.author);
      END`, [], { signal });

    await queryD1(`CREATE TRIGGER IF NOT EXISTS SEARCH_RESULTS_FTS_AU
      AFTER UPDATE ON SEARCH_RESULTS BEGIN
        INSERT INTO SEARCH_RESULTS_FTS(SEARCH_RESULTS_FTS,rowid,title,description,tags_json,author)
        VALUES ('delete',old.id,old.title,old.description,old.tags_json,old.author);
        INSERT INTO SEARCH_RESULTS_FTS(rowid,title,description,tags_json,author)
        VALUES (new.id,new.title,new.description,new.tags_json,new.author);
      END`, [], { signal });

    await queryD1(`CREATE TRIGGER IF NOT EXISTS SEARCH_RESULTS_FTS_AD
      AFTER DELETE ON SEARCH_RESULTS BEGIN
        INSERT INTO SEARCH_RESULTS_FTS(SEARCH_RESULTS_FTS,rowid,title,description,tags_json,author)
        VALUES ('delete',old.id,old.title,old.description,old.tags_json,old.author);
      END`, [], { signal });

    await queryD1(`INSERT INTO SEARCH_RESULTS_FTS(SEARCH_RESULTS_FTS) VALUES ('rebuild')`, [], { signal });
    ftsReady = true;
    return true;
  } catch (error) {
    ftsUnavailable = true;
    console.warn('[D1] FTS5 indisponível; usando fallback LIKE:', error?.message || error);
    return false;
  }
}

async function buscarFts(termos, limit, offset, signal) {
  if (!termos.length || !(await garantirFts(signal))) return null;

  const expressaoAnd = termos.map(escaparFts).join(' AND ');
  const expressaoOr = termos.map(escaparFts).join(' OR ');
  const baseSelect = `SELECT r.id, r.type, r.source, r.title, r.description, r.url,
      r.image_url, r.author, r.language, r.published_at, r.tags_json
    FROM SEARCH_RESULTS_FTS f
    JOIN SEARCH_RESULTS r ON r.id = f.rowid
    WHERE r.status = 'active' AND SEARCH_RESULTS_FTS MATCH ?`;

  const comTodosOsTermos = await queryD1(
    `${baseSelect} ORDER BY bm25(SEARCH_RESULTS_FTS), r.published_at DESC, r.id DESC LIMIT ? OFFSET ?`,
    [expressaoAnd, limit, offset],
    { signal },
  );

  if (comTodosOsTermos.results.length) return mapearResultados(comTodosOsTermos.results, 0.95);

  const porQualquerTermo = await queryD1(
    `${baseSelect} ORDER BY bm25(SEARCH_RESULTS_FTS), r.published_at DESC, r.id DESC LIMIT ? OFFSET ?`,
    [expressaoOr, limit, offset],
    { signal },
  );

  return mapearResultados(porQualquerTermo.results, 0.72);
}

async function buscarLike(termos, query, limit, offset, signal) {
  const termosBusca = termos.length ? termos : [String(query || '').trim().toLowerCase()];
  const condicoes = termosBusca.map(() => "(lower(coalesce(title,'')) LIKE ? OR lower(coalesce(description,'')) LIKE ? OR lower(coalesce(url,'')) LIKE ?)");
  const params = termosBusca.flatMap((termo) => {
    const valor = '%' + termo + '%';
    return [valor, valor, valor];
  });
  params.push(limit, offset);

  const result = await queryD1(
    `SELECT id, type, source, title, description, url, image_url, author, language, published_at, tags_json
     FROM SEARCH_RESULTS
     WHERE status = 'active' AND (${condicoes.join(' OR ')})
     ORDER BY published_at DESC, id DESC
     LIMIT ? OFFSET ?`,
    params,
    { signal },
  );

  return mapearResultados(result.results, 0.65);
}

export async function searchInternal({ query, limit, offset, signal }) {
  const termos = termosDaConsulta(query);

  try {
    const ftsResults = await buscarFts(termos, limit, offset, signal);
    if (ftsResults?.length) return ftsResults;
  } catch (error) {
    console.error('[D1] busca FTS5 falhou; aplicando fallback LIKE:', error?.message || error);
  }

  return buscarLike(termos, query, limit, offset, signal);
}
