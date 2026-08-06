import test from 'node:test';
import assert from 'node:assert/strict';
import { expandQuery } from '../src/services/query-expansion.service.js';

test('busca tipo grafico prioriza consulta especializada', () => {
  const variants = expandQuery('biquíni', 8, { types: ['grafico'] });
  assert.equal(variants[0], 'biquíni gráfico de crochê');
  assert.ok(variants.includes('biquíni diagrama de crochê'));
  assert.ok(variants.includes('biquíni crochet chart'));
});

test('consulta que ja menciona grafico nao duplica o foco', () => {
  const variants = expandQuery('gráfico de biquíni de crochê', 8, { types: ['grafico'] });
  assert.equal(variants[0], 'gráfico de biquíni de crochê');
});

test('busca comum preserva a consulta original como primeira variante', () => {
  const variants = expandQuery('bolsa de crochê');
  assert.equal(variants[0], 'bolsa de crochê');
});
