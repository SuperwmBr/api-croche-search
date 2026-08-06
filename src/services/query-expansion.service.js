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
  ['tutorial', ['passo a passo', 'step by step']]
]);

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

  for (const [term, synonyms] of dictionary) {
    if (!normalized.includes(term)) continue;
    for (const synonym of synonyms) {
      variants.add(normalized.replace(term, synonym));
      if (variants.size >= maxVariants) return [...variants].slice(0, maxVariants);
    }
  }

  return [...variants].slice(0, maxVariants);
}
