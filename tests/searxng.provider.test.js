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

test('usa fallback quando a consulta principal nao encontra a fonte', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const query = new URL(url).searchParams.get('q');
    const isPortugueseFallback = query.includes('flor de crochê passo a passo');
    return {
      ok: true,
      json: async () => ({
        results: isPortugueseFallback ? [{
          url: 'https://www.tiktok.com/@croche/video/999',
          title: 'Flor de crochê passo a passo',
          content: 'Tutorial completo de crochê',
          engine: 'duckduckgo videos',
          category: 'videos'
        }] : [{
          url: 'https://example.com/crochet-flower',
          title: 'Crochet flower tutorial',
          content: 'Crochet tutorial',
          engine: 'duckduckgo',
          category: 'general'
        }]
      })
    };
  };

  try {
    const output = await searchSearxng({
      query: 'crochet flower tutorial site:tiktok.com',
      queries: [
        'crochet flower tutorial site:tiktok.com',
        'flor de crochê passo a passo site:tiktok.com'
      ],
      limit: 20,
      targetResults: 20,
      safeSearch: '1',
      signal: AbortSignal.timeout(1000),
      source: 'tiktok',
      categories: 'general,videos',
      pages: 2
    });

    assert.equal(output.partial, false);
    assert.equal(output.diagnostics.fallbackUsed, true);
    assert.equal(output.diagnostics.queriesRequested, 2);
    assert.equal(output.diagnostics.matchedResults, 1);
    assert.equal(output.results.length, 1);
    assert.equal(output.results[0].url, 'https://www.tiktok.com/@croche/video/999');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('nao executa fallback quando a consulta principal ja atinge o alvo', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    const callNumber = calls;
    return {
      ok: true,
      json: async () => ({
        results: [{
          url: `https://www.tiktok.com/@croche/video/${callNumber}`,
          title: 'Flor de crochê passo a passo',
          content: 'Tutorial de crochê',
          engine: 'duckduckgo videos',
          category: 'videos'
        }]
      })
    };
  };

  try {
    const output = await searchSearxng({
      query: 'flor de crochê site:tiktok.com',
      queries: ['flor de crochê site:tiktok.com', 'crochet flower site:tiktok.com'],
      limit: 20,
      targetResults: 2,
      safeSearch: '1',
      signal: AbortSignal.timeout(1000),
      source: 'tiktok',
      categories: 'general,videos',
      pages: 2
    });

    assert.equal(output.diagnostics.fallbackUsed, false);
    assert.equal(output.diagnostics.queriesRequested, 1);
    assert.equal(calls, 2);
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
