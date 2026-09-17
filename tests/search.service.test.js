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
    assert.equal(output.collectionComplete, true);
    assert.equal('nextBookmark' in output, false);
  } finally {
    globalThis.fetch = originalFetch;
    env.d1Configured = originalD1Configured;
  }
});

test('modo auto NAO chama ValueSerp por padrão (incluir_valueserp ausente)', async () => {
  const originalFetch = globalThis.fetch;
  const originalD1Configured = env.d1Configured;
  const originalApiKey = env.valueserpApiKey;
  env.d1Configured = false;
  env.valueserpApiKey = 'chave-de-teste';
  let valueserpChamado = false;
  globalThis.fetch = async (url) => {
    if (String(url).includes('valueserp.com')) { valueserpChamado = true; return { ok: true, status: 200, json: async () => ({ image_results: [] }) }; }
    return { ok: false, status: 503, json: async () => ({}) };
  };

  try {
    const output = await search({
      q: 'biquini', page: 1, limit: 20, limit_por_fonte: 20,
      provedor: 'auto', provider: undefined, todas_paginas: true,
      max_paginas: undefined, tipo: undefined, fonte: undefined,
      idioma: undefined, nivel: undefined, tecnica: undefined, material: undefined,
      duracao_maxima: undefined, data_inicio: undefined, data_fim: undefined,
      sort: 'relevancia', safe_search: '1', incluir_valueserp: false
    });
    assert.equal(valueserpChamado, false);
    assert.equal('valueserp' in output.providers, false);
  } finally {
    globalThis.fetch = originalFetch;
    env.d1Configured = originalD1Configured;
    env.valueserpApiKey = originalApiKey;
  }
});

test('modo auto soma o ValueSerp quando incluir_valueserp=1 (pesquisa manual)', async () => {
  const originalFetch = globalThis.fetch;
  const originalD1Configured = env.d1Configured;
  const originalApiKey = env.valueserpApiKey;
  env.d1Configured = false;
  env.valueserpApiKey = 'chave-de-teste';
  globalThis.fetch = async (url) => {
    if (String(url).includes('valueserp.com')) {
      return {
        ok: true, status: 200,
        json: async () => ({ image_results: [{ position: 1, title: 'Biquíni de crochê', link: 'https://exemplo.com/biquini-croche', image: 'https://exemplo.com/biquini-croche.jpg', source: 'exemplo.com' }] })
      };
    }
    return { ok: false, status: 503, json: async () => ({}) };
  };

  try {
    const output = await search({
      q: 'biquini', page: 1, limit: 20, limit_por_fonte: 20,
      provedor: 'auto', provider: undefined, todas_paginas: true,
      max_paginas: undefined, tipo: undefined, fonte: undefined,
      idioma: undefined, nivel: undefined, tecnica: undefined, material: undefined,
      duracao_maxima: undefined, data_inicio: undefined, data_fim: undefined,
      sort: 'relevancia', safe_search: '1', incluir_valueserp: true
    });
    assert.equal(output.providers.valueserp, 'ok');
    assert.ok(output.results.some((item) => item.origin === 'exemplo.com' || item.url === 'https://exemplo.com/biquini-croche'));
  } finally {
    globalThis.fetch = originalFetch;
    env.d1Configured = originalD1Configured;
    env.valueserpApiKey = originalApiKey;
  }
});

test('modo auto pula o ValueSerp sem quebrar a busca quando o teto diário já foi atingido', async () => {
  const originalFetch = globalThis.fetch;
  const originalD1Configured = env.d1Configured;
  const originalApiKey = env.valueserpApiKey;
  const originalDailyLimit = env.valueserpDailyLimit;
  env.d1Configured = true;
  env.valueserpApiKey = 'chave-de-teste';
  env.valueserpDailyLimit = 5;
  let valueserpChamado = false;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('valueserp.com')) { valueserpChamado = true; return { ok: true, status: 200, json: async () => ({ image_results: [] }) }; }
    if (String(url).includes('cloudflare.com')) {
      const body = init?.body ? JSON.parse(init.body) : {};
      if (String(body.sql || '').includes('SELECT calls')) return { ok: true, status: 200, json: async () => ({ success: true, result: [{ results: [{ calls: 5 }] }] }) };
      return { ok: true, status: 200, json: async () => ({ success: true, result: [{ results: [] }] }) };
    }
    return { ok: false, status: 503, json: async () => ({}) };
  };

  try {
    const output = await search({
      q: 'biquini teto atingido', page: 1, limit: 20, limit_por_fonte: 20,
      provedor: 'auto', provider: undefined, todas_paginas: true,
      max_paginas: undefined, tipo: undefined, fonte: undefined,
      idioma: undefined, nivel: undefined, tecnica: undefined, material: undefined,
      duracao_maxima: undefined, data_inicio: undefined, data_fim: undefined,
      sort: 'relevancia', safe_search: '1', incluir_valueserp: true
    });
    assert.equal(valueserpChamado, false);
    assert.equal(output.providers.valueserp, 'not_configured');
    assert.equal(output.providerDetails.valueserp?.reason, 'daily_limit_reached');
  } finally {
    globalThis.fetch = originalFetch;
    env.d1Configured = originalD1Configured;
    env.valueserpApiKey = originalApiKey;
    env.valueserpDailyLimit = originalDailyLimit;
  }
});
