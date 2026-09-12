import test from 'node:test';
import assert from 'node:assert/strict';
import { env } from '../src/config/env.js';
import { search } from '../src/services/search.service.js';

test('provedor scraping retorna todos os resultados quando todas_paginas está ativo', async () => {
  const originalFetch = globalThis.fetch;
  const originalD1Configured = env.d1Configured;
  let calls = 0;
  env.d1Configured = false;
  globalThis.fetch = async () => {
    calls += 1;
    const body = calls === 1
      ? { resource_response: { data: { results: [{ id: 'scrape-1', title: 'Gráfico de crochê 1', description: 'Crochê', link: 'https://www.pinterest.com/pin/scrape-1/', images: { orig: { url: 'https://i.pinimg.com/originals/1.jpg' } } }] }, bookmark: 'next-page' } }
      : { resource_response: { data: { results: [{ id: 'scrape-2', title: 'Gráfico de crochê 2', description: 'Crochê', link: 'https://www.pinterest.com/pin/scrape-2/', images: { orig: { url: 'https://i.pinimg.com/originals/2.jpg' } } }] }, bookmark: null } };
    return { ok: true, status: 200, json: async () => body };
  };

  try {
    const output = await search({
      q: 'grafico de croche',
      page: 1,
      limit: 1,
      limit_por_fonte: 1,
      provedor: 'scraping',
      provider: undefined,
      todas_paginas: true,
      max_paginas: 2,
      tipo: undefined,
      fonte: undefined,
      idioma: undefined,
      nivel: undefined,
      tecnica: undefined,
      material: undefined,
      duracao_maxima: undefined,
      data_inicio: undefined,
      data_fim: undefined,
      sort: 'relevancia',
      safe_search: '1'
    });

    assert.equal(calls, 2);
    assert.equal(output.allPages, true);
    assert.equal(output.limitMode, 'all_pages');
    assert.equal(output.total, 2);
    assert.equal(output.totalFetched, 2);
    assert.equal(output.results.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    env.d1Configured = originalD1Configured;
  }
});
