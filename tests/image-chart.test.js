import test from 'node:test';
import assert from 'node:assert/strict';
import { env } from '../src/config/env.js';
import { classifyCrochetChartImages } from '../src/classification/image-chart.js';

test('classifica imagem de pin e marca como gráfico quando o modelo confirma', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = env.openaiApiKey;
  const originalThreshold = env.visionChartThreshold;
  env.openaiApiKey = 'test-key';
  env.visionChartThreshold = 0.75;
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(init.body);
    assert.equal(request.input[0].content[1].image_url, 'https://i.pinimg.com/originals/chart.jpg');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        output_text: '{"isCrochetChart":true,"confidence":0.94,"rationale":"Símbolos organizados em carreiras."}'
      })
    };
  };

  try {
    const pin = {
      type: 'imagem',
      provider: 'pinterest_scraping',
      image: 'https://i.pinimg.com/originals/chart.jpg',
      rankingSignals: { crochetConfidence: 1 }
    };
    const result = await classifyCrochetChartImages([pin]);
    assert.equal(pin.type, 'grafico');
    assert.equal(pin.visualClassification.isCrochetChart, true);
    assert.equal(result.diagnostics.classified, 1);
  } finally {
    globalThis.fetch = originalFetch;
    env.openaiApiKey = originalKey;
    env.visionChartThreshold = originalThreshold;
  }
});

test('não envia URLs de imagem fora do domínio pinimg para o modelo', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = env.openaiApiKey;
  env.openaiApiKey = 'test-key';
  globalThis.fetch = async () => { throw new Error('não deveria chamar o modelo'); };
  try {
    const result = await classifyCrochetChartImages([{
      type: 'imagem', provider: 'pinterest_scraping', image: 'http://127.0.0.1/private.jpg'
    }]);
    assert.equal(result.diagnostics.requested, 0);
    assert.equal(result.diagnostics.classified, 0);
  } finally {
    globalThis.fetch = originalFetch;
    env.openaiApiKey = originalKey;
  }
});
