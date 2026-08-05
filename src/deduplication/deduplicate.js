import { canonicalizeUrl, normalizeText } from '../normalization/text.js';

export function deduplicateResults(results) {
  const seen = new Map();
  for (const result of results) {
    const keys = [
      result.externalId && `${result.origin}:${result.externalId}`,
      result.url && canonicalizeUrl(result.url),
      result.title && `${new URL(result.url).hostname}:${normalizeText(result.title)}`
    ].filter(Boolean);
    const existingKey = keys.find((key) => seen.has(key));
    if (!existingKey) {
      const primaryKey = keys[0] ?? result.id;
      seen.set(primaryKey, result);
      for (const key of keys) seen.set(key, result);
      continue;
    }
    const existing = seen.get(existingKey);
    if ((result.score ?? 0) > (existing.score ?? 0)) {
      for (const [key, value] of seen) if (value === existing) seen.set(key, result);
    }
  }
  return [...new Set(seen.values())];
}
