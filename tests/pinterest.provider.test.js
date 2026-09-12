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
  } finally {
    globalThis.fetch = originalFetch;
  }
});
