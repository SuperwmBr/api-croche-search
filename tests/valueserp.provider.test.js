import test from 'node:test';
import assert from 'node:assert/strict';
import { env } from '../src/config/env.js';
import { searchValueSerp } from '../src/providers/valueserp/valueserp.provider.js';

test('ValueSerp percorre todas as páginas e mapeia image_results', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = env.valueserpApiKey;
  const originalMax = env.valueserpMaxPages;
  const calls = [];
  env.valueserpApiKey = 'test-key';
  env.valueserpMaxPages = 10;
  globalThis.fetch = async (url) => {
    const parsed = new URL(url);
    const page = Number(parsed.searchParams.get('page'));
    calls.push(parsed);
    const body = page === 1
      ? { image_results: [{ position: 1, link: 'https://site.example/a', image: 'https://cdn.example/a.jpg', title: 'Gráfico A' }], pagination: { next_page: 2 } }
      : page === 2
        ? { image_results: [{ position: 1, link: 'https://site.example/b', image: 'https://cdn.example/b.jpg', title: 'Gráfico B' }] }
        : { image_results: [] };
    return { ok: true, status: 200, json: async () => body };
  };

  try {
    const output = await searchValueSerp({ query: 'gráfico de crochê', allPages: true, maxPages: 10, signal: AbortSignal.timeout(1000) });
    assert.equal(calls.length, 3);
    assert.deepEqual(calls.map((url) => url.searchParams.get('page')), ['1', '2', '3']);
    assert.equal(output.results.length, 2);
    assert.equal(output.results[0].image, 'https://cdn.example/a.jpg');
    assert.equal(output.diagnostics.pagesCompleted, 3);
  } finally {
    globalThis.fetch = originalFetch;
    env.valueserpApiKey = originalKey;
    env.valueserpMaxPages = originalMax;
  }
});
