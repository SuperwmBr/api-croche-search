import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSourceQuery, categoriesForSource, matchesSource, sourceFromUrl } from '../src/classification/source.js';

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

test('usa categorias adequadas para descoberta social', () => {
  assert.equal(categoriesForSource('instagram'), 'general,videos');
  assert.equal(categoriesForSource('tiktok'), 'general,videos');
  assert.equal(categoriesForSource('pinterest'), 'general,images');
  assert.equal(categoriesForSource('web'), 'general');
});
