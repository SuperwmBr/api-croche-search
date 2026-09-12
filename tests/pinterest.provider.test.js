import test from 'node:test';
import assert from 'node:assert/strict';
import { searchPinterest } from '../src/providers/pinterest/pinterest.provider.js';

test('scraping do Pinterest percorre bookmarks e preserva imagem original', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls += 1;
    const body = calls === 1
      ? { resource_response: { data: { results: [{ id: '123', title: 'Gráfico de crochê', link: 'https://www.pinterest.com/pin/123/', images: { orig: { url: 'https://i.pinimg.com/originals/a.jpg' } } }] }, bookmark: 'bookmark-1' } }
      : { resource_response: { data: { results: [{ id: '456', title: 'Flor de crochê', link: 'https://www.pinterest.com/pin/456/', images: { orig: { url: 'https://i.pinimg.com/originals/b.jpg' } } }] }, bookmark: null } };
    return { ok: true, status: 200, json: async () => body };
  };

  try {
    const output = await searchPinterest({ query: 'gráfico de crochê', allPages: true, signal: AbortSignal.timeout(1000) });
    assert.equal(calls, 2);
    assert.equal(output.results.length, 2);
    assert.equal(output.results[0].image, 'https://i.pinimg.com/originals/a.jpg');
    assert.equal(output.results[1].origin, 'pinterest');
    assert.equal(output.diagnostics.nextBookmark, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('scraping do Pinterest devolve bookmark quando o lote termina com mais páginas', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        resource_response: {
          data: { results: [{ id: String(calls), title: 'Crochê', link: `https://www.pinterest.com/pin/${calls}/` }] },
          bookmark: `bookmark-${calls + 1}`
        }
      })
    };
  };

  try {
    const output = await searchPinterest({ query: 'crochê', allPages: true, maxPages: 2, signal: AbortSignal.timeout(1000) });
    assert.equal(calls, 2);
    assert.equal(output.partial, true);
    assert.equal(output.diagnostics.hasMore, true);
    assert.equal(output.diagnostics.nextBookmark, 'bookmark-3');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('scraping do Pinterest preserva o lote quando uma página posterior falha', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ resource_response: { data: { results: [{ id: 'ok', title: 'Crochê', link: 'https://www.pinterest.com/pin/ok/' }] }, bookmark: 'retry-page' } })
      };
    }
    return { ok: false, status: 503, json: async () => ({}) };
  };

  try {
    const output = await searchPinterest({ query: 'crochê', allPages: true, maxPages: 2, signal: AbortSignal.timeout(1000) });
    assert.equal(calls, 2);
    assert.equal(output.results.length, 1);
    assert.equal(output.partial, true);
    assert.equal(output.diagnostics.nextBookmark, 'retry-page');
    assert.equal(output.diagnostics.error, 'Pinterest scraping failed (503)');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
