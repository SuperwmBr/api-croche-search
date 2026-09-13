// Portado da versão JÁ CORRIGIDA de src/deduplication/deduplicate.js
// (commit e3a3693 do api-croche-search). Quando resultado tem externalId,
// essa é a ÚNICA chave de identidade usada - nunca é sobrescrita por
// coincidência de canonical_url ou hostname+título (o bug original que
// colapsava pins distintos de listicles ou com título em branco).

import { canonicalizeUrl, normalizeText } from './text.js';

export function deduplicateResults(results) {
  const seen = new Map();
  for (const result of results) {
    const identityKey = result.externalId ? `${result.origin}:${result.externalId}` : null;
    const keys = identityKey
      ? [identityKey]
      : [
          result.url && canonicalizeUrl(result.url),
          result.title?.trim().length > 2 && `${new URL(result.url).hostname}:${normalizeText(result.title)}`
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
