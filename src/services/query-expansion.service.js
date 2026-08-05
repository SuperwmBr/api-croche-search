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
  ['grafico', ['chart', 'diagram']],
  ['receita', ['padrao', 'pattern']],
  ['tutorial', ['passo a passo', 'step by step']]
]);

export function expandQuery(query, maxVariants = 5) {
  const normalized = normalizeText(query);
  const variants = new Set([query.trim()]);
  for (const [term, synonyms] of dictionary) {
    if (!normalized.includes(term)) continue;
    for (const synonym of synonyms) {
      variants.add(normalized.replace(term, synonym));
      if (variants.size >= maxVariants) return [...variants];
    }
  }
  return [...variants];
}
