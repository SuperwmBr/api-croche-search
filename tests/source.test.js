import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSourceQueries, buildSourceQuery, categoriesForSource, matchesSource, sourceFromUrl } from '../src/classification/source.js';

test('normaliza origem pelas URLs das plataformas', () => {
  assert.equal(sourceFromUrl('https://www.instagram.com/reel/ABC/'), 'instagram');
  assert.equal(sourceFromUrl('https://www.tiktok.com/@autor/video/123'), 'tiktok');
  assert.equal(sourceFromUrl('https://br.pinterest.com/pin/123/'), 'pinterest');
  assert.equal(sourceFromUrl('https://site.com/receita.pdf'), 'pdf');
});

test('filtra subdominios legitimos sem aceitar dominios parecidos', () => {
  assert.equal(matchesSource('https://www.instagram.com/p/ABC/', 'instagram'), true);
  assert.equal(matchesSource('https://instagram.com.evil.example/p/ABC/', 'instagram'), false);
  assert.equal(matchesSource('https://m.tiktok.com/v/123', 'tiktok'), true);
  assert.equal(matchesSource('https://br.pinterest.com/pin/123/', 'pinterest'), true);
});

test('monta consultas dedicadas por fonte', () => {
  assert.equal(buildSourceQuery('flor de crochê', 'instagram'), 'flor de crochê site:instagram.com');
  assert.equal(buildSourceQuery('flor de crochê', 'tiktok'), 'flor de crochê site:tiktok.com');
  assert.equal(buildSourceQuery('flor de crochê', 'pinterest'), 'flor de crochê site:pinterest.com/pin');
  assert.equal(buildSourceQuery('flor de crochê', 'pdf'), 'flor de crochê filetype:pdf');
});

test('gera fallback em portugues para consulta social em ingles', () => {
  const queries = buildSourceQueries('crochet flower tutorial', 'tiktok');
  assert.equal(queries[0], 'crochet flower tutorial site:tiktok.com');
  assert.ok(queries.includes('flor de crochê passo a passo site:tiktok.com'));
  assert.equal(new Set(queries).size, queries.length);
  assert.ok(queries.length <= 4);
});

test('relaxa qualificadores e cria variante inglesa natural', () => {
  const queries = buildSourceQueries('flor de crochê fácil tutorial completo', 'instagram');
  assert.ok(queries.includes('flor de crochê site:instagram.com'));
  assert.ok(queries.some((query) => query.includes('crochet flower')));
});

test('fontes nao sociais mantem somente a consulta principal', () => {
  assert.deepEqual(buildSourceQueries('receita de tapete', 'pdf'), ['receita de tapete filetype:pdf']);
});

test('usa categorias adequadas para descoberta social', () => {
  assert.equal(categoriesForSource('instagram'), 'general,videos');
  assert.equal(categoriesForSource('tiktok'), 'general,videos');
  assert.equal(categoriesForSource('pinterest'), 'general,images');
  assert.equal(categoriesForSource('web'), 'general');
});
