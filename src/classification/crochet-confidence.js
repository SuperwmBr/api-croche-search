import { normalizeText } from '../normalization/text.js';

// Termos que indicam com segurança que o conteúdo é mesmo sobre crochê —
// mesma lista usada no frontend, agora movida para cá (ver histórico:
// termos ambíguos como "ponto" sozinhos batiam com notícia de juros,
// política e cânticos de umbanda, então não bastam por si só).
const CROCHET_TERMS = [
  'croche',
  'crochet',
  'amigurumi',
  'granny square',
  'anel magico',
  'ponto baixo',
  'ponto alto',
  'ponto corrente',
  'ponto vareta',
  'meia trave'
];

const CONFIANCA_ALTA = 0.9;
const CONFIANCA_BAIXA = 0.1;

// Substitui o valor fixo que cada provedor devolvia antes (sempre 0.65/0.7,
// não importa o conteúdo) por um cálculo de verdade em cima do texto.
export function computeCrochetConfidence(title = '', description = '') {
  const text = normalizeText(`${title} ${description}`);
  return CROCHET_TERMS.some((term) => text.includes(term)) ? CONFIANCA_ALTA : CONFIANCA_BAIXA;
}
