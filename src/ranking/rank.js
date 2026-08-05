const defaults = { textual: 0.35, source: 0.20, crochet: 0.20, freshness: 0.10, engagement: 0.10, completeness: 0.05 };
const clamp = (n) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

export function calculateScore(signals, weights = defaults) {
  return Number((
    clamp(signals.textualRelevance) * weights.textual +
    clamp(signals.sourceQuality) * weights.source +
    clamp(signals.crochetConfidence) * weights.crochet +
    clamp(signals.freshness) * weights.freshness +
    clamp(signals.engagement) * weights.engagement +
    clamp(signals.completeness) * weights.completeness
  ).toFixed(6));
}
