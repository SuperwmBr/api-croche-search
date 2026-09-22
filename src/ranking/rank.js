const legacyDefaults = { textual: 0.35, source: 0.20, crochet: 0.20, freshness: 0.10, engagement: 0.10, completeness: 0.05 };
const relevanceDefaults = {
  textual: 0.42,
  intent: 0.18,
  crochet: 0.18,
  source: 0.10,
  freshness: 0.05,
  engagement: 0.03,
  completeness: 0.04
};

const STOP_WORDS = new Set([
  'a', 'as', 'o', 'os', 'um', 'uma', 'uns', 'umas', 'de', 'da', 'do', 'das', 'dos',
  'em', 'no', 'na', 'nos', 'nas', 'para', 'por', 'com', 'e', 'ou', 'que', 'como',
  'the', 'a', 'an', 'of', 'in', 'on', 'for', 'with', 'and', 'or', 'to'
]);

const clamp = (n) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

function normalize(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value) {
  return [...new Set(normalize(value)
    .split(' ')
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token)))];
}

function asText(value) {
  return Array.isArray(value) ? value.join(' ') : String(value ?? '');
}

function tokenCoverage(text, queryTokens) {
  if (!queryTokens.length) return 0.5;
  const normalizedText = normalize(text);
  return queryTokens.filter((token) => normalizedText.includes(token)).length / queryTokens.length;
}

function queryIntent(query, requestedTypes) {
  const text = normalize(query);
  const visual = Boolean(requestedTypes?.some((type) => ['imagem', 'grafico', 'pdf'].includes(type)))
    || /\b(grafico|graficos|diagrama|diagramas|chart|charts|pattern|patterns|esquema|imagem|foto|modelo|inspiracao|inspiracao)\b/.test(text);
  const tutorial = /\b(como fazer|passo a passo|tutorial|aprenda|ensinar|aula|how to|tutorial)\b/.test(text);
  return { visual, tutorial };
}

export function calculateTextualRelevance(query, item = {}) {
  const queryTokens = tokens(query);
  if (!queryTokens.length) return 0.5;

  const title = asText(item.title);
  const description = asText(item.description);
  const tags = asText(item.tags);
  const url = asText(item.url);
  const weightedCoverage =
    tokenCoverage(title, queryTokens) * 0.55
    + tokenCoverage(description, queryTokens) * 0.25
    + tokenCoverage(tags, queryTokens) * 0.15
    + tokenCoverage(url, queryTokens) * 0.05;
  const normalizedQuery = normalize(query);
  const normalizedTitle = normalize(title);
  const normalizedDescription = normalize(description);
  const exactPhraseBoost = normalizedQuery.length >= 4 && normalizedTitle.includes(normalizedQuery)
    ? 0.18
    : normalizedQuery.length >= 4 && normalizedDescription.includes(normalizedQuery)
      ? 0.08
      : 0;
  const allTermsBoost = queryTokens.every((token) => normalizedTitle.includes(token))
    ? 0.12
    : queryTokens.every((token) => normalizedTitle.includes(token) || normalize(description).includes(token))
      ? 0.06
      : 0;

  return clamp(weightedCoverage * 0.70 + exactPhraseBoost + allTermsBoost);
}

export function calculateIntentRelevance(query, item = {}, requestedTypes = null) {
  const { visual, tutorial } = queryIntent(query, requestedTypes);
  const type = item.type;
  const isVisual = ['imagem', 'grafico', 'pdf'].includes(type);
  const isVideo = type === 'video' || item.origin === 'youtube' || item.origin === 'tiktok';

  if (visual) {
    if (isVisual) return 1;
    if (isVideo) return 0.35;
    return 0.45;
  }
  if (tutorial) {
    if (isVideo) return 1;
    if (isVisual) return 0.55;
    return 0.5;
  }
  return 0.5;
}

export function calculateRelevanceScore(signals, weights = relevanceDefaults) {
  return Number((
    clamp(signals.textualRelevance) * weights.textual +
    clamp(signals.intentRelevance) * weights.intent +
    clamp(signals.crochetConfidence) * weights.crochet +
    clamp(signals.sourceQuality) * weights.source +
    clamp(signals.freshness) * weights.freshness +
    clamp(signals.engagement) * weights.engagement +
    clamp(signals.completeness) * weights.completeness
  ).toFixed(6));
}

export function rankResult(item, query, requestedTypes = null) {
  const signals = {
    ...(item.rankingSignals ?? {}),
    textualRelevance: calculateTextualRelevance(query, item),
    intentRelevance: calculateIntentRelevance(query, item, requestedTypes)
  };
  return {
    ...item,
    rankingSignals: signals,
    score: calculateRelevanceScore(signals)
  };
}

// Mantida para compatibilidade com consumidores e testes legados.
export function calculateScore(signals, weights = legacyDefaults) {
  return Number((
    clamp(signals.textualRelevance) * weights.textual +
    clamp(signals.sourceQuality) * weights.source +
    clamp(signals.crochetConfidence) * weights.crochet +
    clamp(signals.freshness) * weights.freshness +
    clamp(signals.engagement) * weights.engagement +
    clamp(signals.completeness) * weights.completeness
  ).toFixed(6));
}
