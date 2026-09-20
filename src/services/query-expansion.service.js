import { normalizeText } from '../normalization/text.js';

const dictionary = new Map([
  ['croche', ['crochet']],
  ['amigurumi', ['crochet toy', 'boneco de croche']],
  ['granny square', ['quadrado da vovo', 'crochet square']],
  ['fio', ['linha', 'yarn']],
  ['linha', ['fio', 'yarn']],
  ['agulha', ['crochet hook']],
  ['ponto baixo', ['single crochet']],
  ['ponto alto', ['double crochet']],
  ['circulo magico', ['magic ring']],
  ['grafico', ['diagrama de croche', 'receita grafica', 'crochet chart']],
  ['diagrama', ['grafico de croche', 'crochet diagram']],
  ['receita', ['padrao', 'pattern']],
  ['tutorial', ['passo a passo', 'step by step']],
  ['aplique', ['aplicacao', 'motivo', 'applique']],
  ['camisa', ['blusa', 'shirt']],
  ['mandala', ['motivo circular', 'crochet mandala']]
]);

const STOPWORDS = new Set(['para', 'em', 'de', 'da', 'do', 'das', 'dos', 'com', 'a', 'o', 'e']);

function compact(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function semanticVariants(query) {
  const original = compact(query);
  const normalized = normalizeText(original);
  const tokens = normalized
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));

  const variants = [];
  const hasMandala = tokens.includes('mandala');
  const hasApplique = tokens.includes('aplique') || tokens.includes('aplicacao');
  const hasCamisa = tokens.includes('camisa') || tokens.includes('blusa');
  const hasCroche = tokens.includes('croche') || tokens.includes('crochet');
  const hasChart = tokens.includes('chart') || tokens.includes('grafico') || tokens.includes('diagrama');

  if (hasMandala && hasApplique && hasCamisa && hasCroche) {
    variants.push('mandala crochê aplique camisa');
    variants.push('mandala crochê aplique blusa');
    variants.push('crochet mandala applique shirt');
    if (hasChart) variants.push('crochet chart mandala applique shirt');
  } else if (tokens.length >= 2) {
    variants.push(compact(tokens.join(' ')));
  }

  return variants;
}

function graphFocusedQueries(query) {
  const normalized = normalizeText(query);
  const alreadyFocused = /\b(grafico|diagrama|chart|esquema|receita grafica)\b/.test(normalized);
  if (alreadyFocused) return [query.trim()];
  return [
    `${query.trim()} gráfico de crochê`,
    `${query.trim()} diagrama de crochê`,
    `${query.trim()} receita gráfica crochê`,
    `${query.trim()} crochet chart`,
    query.trim()
  ];
}

export function expandQuery(query, maxVariants = 5, options = {}) {
  const normalized = normalizeText(query);
  const types = Array.isArray(options.types) ? options.types : [];
  const variants = new Set(types.includes('grafico') ? graphFocusedQueries(query) : [query.trim()]);

  for (const variant of semanticVariants(query)) {
    variants.add(variant);
    if (variants.size >= maxVariants) return [...variants].slice(0, maxVariants);
  }

  for (const [term, synonyms] of dictionary) {
    if (!normalized.includes(term)) continue;
    for (const synonym of synonyms) {
      variants.add(normalized.replace(term, synonym));
      if (variants.size >= maxVariants) return [...variants].slice(0, maxVariants);
    }
  }

  return [...variants].slice(0, maxVariants);
}
