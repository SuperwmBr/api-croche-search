import test from 'node:test';
import assert from 'node:assert/strict';
import { searchSearxng } from '../src/providers/searxng/searxng.provider.js';

test('preserva resultados quando uma pagina do SearXNG falha', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const page = new URL(url).searchParams.get('pageno');
    if (page === '2') throw new DOMException('timeout', 'TimeoutError');
    return {
      ok: true,
      json: async () => ({
        results: [{
          url: `https://www.tiktok.com/@croche/video/${page}`,
          title: 'Tutorial de crochê passo a passo',
          content: 'Aprenda crochê e amigurumi',
          engine: 'bing videos',
          category: 'videos'
        }]
      })
    };
  };

  try {
    const output = await searchSearxng({
      query: 'crochê site:tiktok.com',
      limit: 20,
      safeSearch: '1',
      signal: AbortSignal.timeout(1000),
      source: 'tiktok',
      categories: 'general,videos',
      pages: 3
    });

    assert.equal(output.partial, true);
    assert.equal(output.diagnostics.pagesRequested, 3);
    assert.equal(output.diagnostics.pagesCompleted, 2);
    assert.equal(output.diagnostics.pagesFailed, 1);
    assert.equal(output.results.length, 2);
    assert.ok(output.results.every((item) => item.origin === 'tiktok'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('propaga falha quando nenhuma pagina do SearXNG responde', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new DOMException('timeout', 'TimeoutError'); };

  try {
    await assert.rejects(() => searchSearxng({
      query: 'crochê',
      limit: 20,
      safeSearch: '1',
      signal: AbortSignal.timeout(1000),
      pages: 2
    }), (error) => error?.name === 'TimeoutError');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
