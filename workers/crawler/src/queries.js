// Deriva as queries que o cron deve manter "quentes" a partir de dados que
// JÁ existem em SEARCH_RESULTS (título/tags) - não depende de SEARCH_QUERIES,
// que hoje não é gravada por nada no código (ver api-croche-search,
// src/services/search.service.js: nenhum INSERT INTO SEARCH_QUERIES).
//
// Estratégia:
//  1. Pega uma amostra recente de títulos/tags de SEARCH_RESULTS.
//  2. Tokeniza e extrai bigramas/trigramas que contenham um marcador de
//     domínio (crochê/crochet/amigurumi/etc).
//  3. Conta frequência - os mais comuns viram as queries do ciclo.
//  4. Preenche com uma lista-semente pequena quando a tabela ainda não tem
//     dado suficiente (banco vazio / primeiro deploy) ou quando a extração
//     não preenche o limite pedido.

import { normalizeText } from './text.js';

const STOPWORDS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'com', 'para', 'por', 'em', 'no', 'na', 'nos', 'nas',
  'a', 'o', 'as', 'os', 'e', 'ou', 'um', 'uma', 'que', 'como',
  'the', 'and', 'for', 'with', 'to', 'of', 'in', 'on', 'a', 'is', 'are',
  'free', 'pattern', 'patterns', 'ideas', 'idea'
]);

const CROCHET_MARKERS = ['croche', 'crochet', 'amigurumi', 'trico', 'tricot', 'grafico'];

const SEED_QUERIES = [
  'grafico de croche',
  'receita de croche',
  'ponto de croche',
  'amigurumi croche',
  'croche para iniciantes',
  'blusa de croche',
  'vestido de croche',
  'tapete de croche',
  'bolsa de croche',
  'sandalia de croche'
];

function tokenize(text) {
  return normalizeText(text).split(' ').filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

function ngrams(tokens, n) {
  const out = [];
  for (let i = 0; i <= tokens.length - n; i += 1) out.push(tokens.slice(i, i + n).join(' '));
  return out;
}

export async function deriveTrackedQueries(db, limit = 10) {
  const freq = new Map();

  try {
    const { results } = await db.prepare(
      `SELECT title, tags_json FROM SEARCH_RESULTS WHERE status = 'active' ORDER BY indexed_at DESC LIMIT 500`
    ).all();

    for (const row of results ?? []) {
      const tokens = tokenize(row.title || '');
      for (const phrase of [...ngrams(tokens, 2), ...ngrams(tokens, 3)]) {
        if (!CROCHET_MARKERS.some((marker) => phrase.includes(marker))) continue;
        freq.set(phrase, (freq.get(phrase) || 0) + 1);
      }
      try {
        const tags = JSON.parse(row.tags_json || '[]');
        for (const tag of tags) {
          const normalizedTag = normalizeText(String(tag));
          if (normalizedTag.length > 2) freq.set(normalizedTag, (freq.get(normalizedTag) || 0) + 2);
        }
      } catch {
        // tags_json malformado - ignora, não é crítico pra essa derivação
      }
    }
  } catch (error) {
    // SEARCH_RESULTS pode não existir ainda num banco recém-criado;
    // segue só com a lista-semente nesse caso.
    console.error('[queries] falha ao ler SEARCH_RESULTS para derivar queries', error?.message || error);
  }

  const derived = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([phrase]) => phrase);
  const combined = [...new Set([...derived, ...SEED_QUERIES])];
  return combined.slice(0, limit);
}
