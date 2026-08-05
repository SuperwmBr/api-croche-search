import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText, canonicalizeUrl } from '../src/normalization/text.js';
import { expandQuery } from '../src/services/query-expansion.service.js';
import { calculateScore } from '../src/ranking/rank.js';
import { deduplicateResults } from '../src/deduplication/deduplicate.js';

test('normaliza texto em português', () => assert.equal(normalizeText('Bolsa de Crochê!'), 'bolsa de croche'));
test('remove parâmetros de rastreamento', () => assert.equal(canonicalizeUrl('https://www.exemplo.com/post/?utm_source=x&id=1'), 'https://exemplo.com/post?id=1'));
test('expande termos controlados', () => assert.ok(expandQuery('amigurumi iniciante').length > 1));
test('score respeita fórmula configurada', () => assert.equal(calculateScore({ textualRelevance: 1, sourceQuality: 1, crochetConfidence: 1, freshness: 1, engagement: 1, completeness: 1 }), 1));
test('deduplica por URL canônica', () => {
  const input = [
    { id: '1', origin: 'a', title: 'Receita', url: 'https://site.com/x?utm_source=a', score: 0.5 },
    { id: '2', origin: 'b', title: 'Receita', url: 'https://www.site.com/x', score: 0.9 }
  ];
  const output = deduplicateResults(input);
  assert.equal(output.length, 1);
  assert.equal(output[0].id, '2');
});
