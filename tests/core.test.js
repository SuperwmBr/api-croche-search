import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText, canonicalizeUrl } from '../src/normalization/text.js';
import { expandQuery } from '../src/services/query-expansion.service.js';
import { calculateScore, calculateTextualRelevance, calculateIntentRelevance, calculateRelevanceScore, rankResult } from '../src/ranking/rank.js';
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

test('relevância textual favorece correspondência exata de título', () => {
  const exato = calculateTextualRelevance('suporte croche chart', { title: 'Suporte de crochê chart', description: '' });
  const generico = calculateTextualRelevance('suporte croche chart', { title: 'Ideias de crochê', description: 'Inspirações variadas' });
  assert.ok(exato > generico);
});

test('intenção visual favorece imagem em busca por gráfico', () => {
  const imagem = calculateIntentRelevance('gráfico de crochê', { type: 'imagem', origin: 'pinterest' });
  const video = calculateIntentRelevance('gráfico de crochê', { type: 'video', origin: 'youtube' });
  assert.ok(imagem > video);
});

test('rankResult atualiza results com score final e sinais da consulta', () => {
  const ranked = rankResult({
    id: 'pinterest:1',
    origin: 'pinterest',
    type: 'imagem',
    title: 'Gráfico de suporte de crochê',
    description: 'Crochet chart',
    rankingSignals: { sourceQuality: 0.65, crochetConfidence: 1, freshness: 0.5, engagement: 0.3, completeness: 0.95 }
  }, 'suporte crochê chart');

  assert.ok(ranked.score > 0);
  assert.equal(ranked.rankingSignals.intentRelevance, 1);
  assert.equal(ranked.rankingSignals.textualRelevance > 0, true);
});

test('score de relevância preserva intervalo entre zero e um', () => {
  assert.equal(calculateRelevanceScore({
    textualRelevance: 1,
    intentRelevance: 1,
    sourceQuality: 1,
    crochetConfidence: 1,
    freshness: 1,
    engagement: 1,
    completeness: 1
  }), 1);
});
