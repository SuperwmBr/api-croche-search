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
    assert.equal(output.providerCounts.scraping.fetched, 2);
    assert.equal(output.providerCounts.scraping.accepted, 2);
    assert.equal(output.providerCounts.scraping.returned, 2);
    assert.equal(output.collectionComplete, true);
    assert.equal('nextBookmark' in output, false);
  } finally {
    globalThis.fetch = originalFetch;
    env.d1Configured = originalD1Configured;
  }
});

test('classificação visual é opt-in e promove imagem do Pinterest a gráfico', async () => {
  const originalFetch = globalThis.fetch;
  const originalD1Configured = env.d1Configured;
  const originalApiKey = env.groqApiKey;
  env.d1Configured = false;
  env.groqApiKey = 'test-key';
  globalThis.fetch = async (url) => {
    if (String(url).includes('api.groq.com/openai/v1/responses')) {
      return {
        ok: true, status: 200,
        json: async () => ({ output_text: '{"isCrochetChart":true,"confidence":0.96,"rationale":"Símbolos em carreiras."}' })
      };
    }
    return {
      ok: true, status: 200,
      json: async () => ({
        resource_response: {
          data: { results: [{ id: 'chart-pin', title: 'Crochê', link: 'https://www.pinterest.com/pin/chart-pin/', images: { orig: { url: 'https://i.pinimg.com/originals/chart.jpg' } } }] },
          bookmark: null
        }
      })
    };
  };

  try {
    const output = await search({
      q: 'grafico de croche', page: 1, limit: 5, limit_por_fonte: 5,
      provedor: 'scraping', provider: undefined, todas_paginas: false,
      max_paginas: 1, tipo: undefined, fonte: undefined, idioma: undefined,
      nivel: undefined, tecnica: undefined, material: undefined,
      duracao_maxima: undefined, data_inicio: undefined, data_fim: undefined,
      sort: 'relevancia', safe_search: '1', identificar_graficos: true
    });
    assert.equal(output.results[0].type, 'grafico');
    assert.equal(output.results[0].visualClassification.isCrochetChart, true);
    assert.equal(output.enrichment.imageClassification.classified, 1);
  } finally {
    globalThis.fetch = originalFetch;
    env.d1Configured = originalD1Configured;
    env.groqApiKey = originalApiKey;
  }
});

test('somente_graficos usa a consulta do Pinterest sem chamar Groq por padrão', async () => {
  const originalFetch = globalThis.fetch;
  const originalD1Configured = env.d1Configured;
  const originalApiKey = env.groqApiKey;
  env.d1Configured = false;
  env.groqApiKey = '';
  let groqCalled = false;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('api.groq.com/openai/v1/responses')) {
      groqCalled = true;
      throw new Error('Groq não deve ser chamada sem identificar_graficos=1');
    }
    return {
      ok: true, status: 200,
      json: async () => ({ resource_response: { data: { results: [
        { id: 'bikini-chart', title: 'Bikini crochet diagram', description: 'Bikini chart', link: 'https://www.pinterest.com/pin/bikini-chart/', images: { orig: { url: 'https://i.pinimg.com/originals/bikini-chart.jpg' } } },
        { id: 'generic-chart-only', title: 'Gráfico de crochê: mandala', link: 'https://www.pinterest.com/pin/generic-chart-only/', images: { orig: { url: 'https://i.pinimg.com/originals/generic-chart.jpg' } } },
        { id: 'photo-pin-only', title: 'Bolsa de crochê pronta', link: 'https://www.pinterest.com/pin/photo-pin-only/', images: { orig: { url: 'https://i.pinimg.com/originals/photo.jpg' } } }
      ] }, bookmark: null } })
    };
  };

  try {
    const output = await search({
      q: 'biquini crochê crochet chart', page: 1, limit: 5, limit_por_fonte: 5,
      provedor: 'scraping', provider: undefined, todas_paginas: false,
      max_paginas: 1, tipo: undefined, fonte: undefined, idioma: undefined,
      nivel: undefined, tecnica: undefined, material: undefined,
      duracao_maxima: undefined, data_inicio: undefined, data_fim: undefined,
      sort: 'relevancia', safe_search: '1', somente_graficos: true
    });

    assert.deepEqual(output.results.map((item) => item.id), [
      'pinterest:bikini-chart', 'pinterest:generic-chart-only', 'pinterest:photo-pin-only'
    ]);
    assert.ok(output.results.every((item) => item.type === 'grafico'));
    assert.ok(output.results.every((item) => item.classificationBasis === 'pinterest_search_query'));
    assert.ok(output.providerDetails.scraping.queriesRequested > 1);
    assert.equal(groqCalled, false);
    assert.equal(output.enrichment.imageClassification, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    env.d1Configured = originalD1Configured;
    env.groqApiKey = originalApiKey;
  }
});

test('somente_graficos não descarta pins do Pinterest por metadados vazios ou sem assunto', async () => {
  const originalFetch = globalThis.fetch;
  const originalD1Configured = env.d1Configured;
  env.d1Configured = false;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ resource_response: { data: { results: [
      { id: 'bikini-photo', title: ' ', description: ' ', link: 'https://www.pinterest.com/pin/bikini-photo/', images: { orig: { url: 'https://i.pinimg.com/originals/bikini-photo.jpg' } } },
      { id: 'flower-chart', title: '', description: '', link: 'https://www.pinterest.com/pin/flower-chart/', images: { orig: { url: 'https://i.pinimg.com/originals/flower-chart.jpg' } } }
    ] }, bookmark: null } })
  });

  try {
    const output = await search({
      q: 'biquini de croche chart', page: 1, limit: 5, limit_por_fonte: 5,
      provedor: 'scraping', provider: undefined, todas_paginas: false,
      max_paginas: 1, tipo: undefined, fonte: undefined, idioma: undefined,
      nivel: undefined, tecnica: undefined, material: undefined,
      duracao_maxima: undefined, data_inicio: undefined, data_fim: undefined,
      sort: 'relevancia', safe_search: '1', somente_graficos: true
    });

    assert.equal(output.providerCounts.scraping.fetched, 2);
    assert.equal(output.providerCounts.scraping.accepted, 2);
    assert.equal(output.providerCounts.scraping.returned, 2);
    assert.equal(output.totalFetched, 2);
    assert.equal(output.total, 2);
    assert.ok(output.results.every((item) => item.type === 'grafico'));
  } finally {
    globalThis.fetch = originalFetch;
    env.d1Configured = originalD1Configured;
  }
});

test('busca genérica de gráficos envia a frase exata ao Pinterest sem fan-out', async () => {
  const originalFetch = globalThis.fetch;
  const originalD1Configured = env.d1Configured;
  env.d1Configured = false;
  const requestedQueries = [];
  globalThis.fetch = async (url) => {
    const request = JSON.parse(new URL(url).searchParams.get('data'));
    requestedQueries.push(request.options.query);
    return {
      ok: true,
      status: 200,
      json: async () => ({ resource_response: { data: { results: [
        { id: 'chart-1', title: '', description: '', link: 'https://www.pinterest.com/pin/chart-1/' },
        { id: 'chart-2', title: 'Gráfico de crochê', link: 'https://www.pinterest.com/pin/chart-2/' }
      ] }, bookmark: 'more' } })
    };
  };

  try {
    const output = await search({
      q: 'grafico de croche', page: 1, limit: 10, limit_por_fonte: 10,
      provedor: 'scraping', provider: undefined, todas_paginas: false,
      max_paginas: 1, tipo: undefined, fonte: undefined, idioma: undefined,
      nivel: undefined, tecnica: undefined, material: undefined,
      duracao_maxima: undefined, data_inicio: undefined, data_fim: undefined,
      sort: 'relevancia', safe_search: '1', somente_graficos: true
    });
    assert.deepEqual(requestedQueries, ['grafico de croche']);
    assert.equal(output.providerDetails.scraping.pagesRequested, 1);
    assert.equal(output.providerCounts.scraping.accepted, 2);
    assert.equal(output.results[0].id, 'pinterest:chart-1');
  } finally {
    globalThis.fetch = originalFetch;
    env.d1Configured = originalD1Configured;
  }
});

test('crawl salvo examina todos os pins antes de filtrar e respeita limite de resultados', async () => {
  const originalFetch = globalThis.fetch;
  const originalD1Configured = env.d1Configured;
  const originalAccountId = env.CLOUDFLARE_ACCOUNT_ID;
  const originalDatabaseId = env.CLOUDFLARE_D1_DATABASE_ID;
  const originalCloudflareToken = env.CLOUDFLARE_API_TOKEN;
  const originalSearchTimeout = env.SEARCH_PROVIDER_TIMEOUT_MS;
  let resultRows = [];
  const job = {
    id: 'pinterest-test-crawl',
    crawl_key: 'test-key',
    provider: 'scraping',
    query: 'biquini croche crochet chart',
    params_json: JSON.stringify({ limit: 5, batchPages: 3, maxPages: null }),
    status: 'complete',
    next_bookmark: null,
    pages_completed: 2,
    results_count: 101,
    attempts: 1,
    error_message: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    completed_at: new Date().toISOString()
  };

  env.d1Configured = true;
  env.CLOUDFLARE_ACCOUNT_ID = 'test-account';
  env.CLOUDFLARE_D1_DATABASE_ID = '020a20e7-829a-4df3-9e15-ed37949901b5';
  env.CLOUDFLARE_API_TOKEN = 'test-token';
  env.SEARCH_PROVIDER_TIMEOUT_MS = 1000;
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(init.body);
    let results = [];
    if (request.sql.includes('WHERE crawl_key = ?')) results = [job];
    else if (request.sql.includes('WHERE id = ?')) results = [job];
    else if (request.sql.includes('FROM SEARCH_CRAWL_ITEMS')) {
      const [, limit, offset] = request.params;
      results = resultRows.slice(offset, offset + limit);
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, result: [{ results, meta: {} }] })
    };
  };

  resultRows = Array.from({ length: 101 }, (_, index) => {
    const isRelevant = index === 100;
    const pinId = `pin-${index + 1}`;
    return {
      id: index + 1,
      external_id: pinId,
      type: 'imagem',
      source: 'pinterest',
      title: isRelevant ? 'Bikini crochet chart' : 'Crochet chart pattern',
      description: isRelevant ? 'Bikini diagram' : 'Crochet diagram',
      url: `https://www.pinterest.com/pin/${pinId}/`,
      canonical_url: `https://www.pinterest.com/pin/${pinId}/`,
      image_url: `https://i.pinimg.com/originals/${pinId}.jpg`,
      author: null,
      language: 'pt-BR',
      published_at: '2026-09-29T00:00:00.000Z',
      tags_json: '[]',
      metadata_json: JSON.stringify({ provider: 'pinterest_scraping', engine: 'pinterest' }),
      source_quality: 0.65
    };
  });

  try {
    const output = await search({
      q: 'biquini croche crochet chart', page: 1, limit: 5, limit_por_fonte: 5,
      provedor: 'scraping', provider: undefined, todas_paginas: true,
      max_paginas: undefined, tipo: undefined, fonte: undefined, idioma: undefined,
      nivel: undefined, tecnica: undefined, material: undefined,
      duracao_maxima: undefined, data_inicio: undefined, data_fim: undefined,
      sort: 'relevancia', safe_search: '1', somente_graficos: true
    });

    assert.equal(output.totalFetched, 101);
    assert.equal(output.total, 101);
    assert.equal(output.results.length, 101);
    assert.ok(output.results.every((item) => item.type === 'grafico'));
    assert.ok(output.results.every((item) => item.classificationBasis === 'pinterest_search_query'));
  } finally {
    globalThis.fetch = originalFetch;
    env.d1Configured = originalD1Configured;
    env.CLOUDFLARE_ACCOUNT_ID = originalAccountId;
    env.CLOUDFLARE_D1_DATABASE_ID = originalDatabaseId;
    env.CLOUDFLARE_API_TOKEN = originalCloudflareToken;
    env.SEARCH_PROVIDER_TIMEOUT_MS = originalSearchTimeout;
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
    assert.equal(output.providerCounts.valueserp.fetched, 1);
    assert.equal(output.providerCounts.valueserp.accepted, 1);
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
    assert.equal(output.providers.valueserp, 'quota_exhausted');
    assert.equal(output.providerDetails.valueserp?.reason, 'daily_limit_reached');
  } finally {
    globalThis.fetch = originalFetch;
    env.d1Configured = originalD1Configured;
    env.valueserpApiKey = originalApiKey;
    env.valueserpDailyLimit = originalDailyLimit;
  }
});
