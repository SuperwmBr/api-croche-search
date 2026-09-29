import { env } from '../config/env.js';

const clamp = (value) => Math.max(0, Math.min(1, Number(value) || 0));

function responseText(body) {
  if (typeof body?.output_text === 'string') return body.output_text;
  return (body?.output || [])
    .flatMap((item) => item.content || [])
    .filter((part) => part.type === 'output_text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n');
}

function parseClassification(text) {
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error('Resposta do modelo sem JSON de classificação');
  const value = JSON.parse(json);
  return {
    isCrochetChart: Boolean(value.isCrochetChart),
    confidence: clamp(value.confidence),
    rationale: String(value.rationale || '').slice(0, 300)
  };
}

async function classifyImage(imageUrl) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.openaiApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: env.openaiVisionModel,
      input: [{
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: 'Classifique a imagem. Considere gráfico de crochê somente uma representação visual de pontos, símbolos, carreiras ou instruções para executar uma peça de crochê. Uma foto de uma peça pronta, uma pessoa crocheteira, um tutorial em vídeo ou uma imagem decorativa não é um gráfico. Responda somente JSON: {"isCrochetChart": boolean, "confidence": número entre 0 e 1, "rationale": "motivo curto em português"}.'
          },
          { type: 'input_image', image_url: imageUrl, detail: 'low' }
        ]
      }],
      max_output_tokens: 120
    }),
    signal: AbortSignal.timeout(env.openaiVisionTimeoutMs)
  });

  const body = await response.json().catch(() => null);
  if (!response.ok || !body) throw new Error(`OpenAI Vision respondeu HTTP ${response.status}`);
  return parseClassification(responseText(body));
}

export async function classifyCrochetChartImages(items, { limit = env.visionMaxImagesPerSearch } = {}) {
  const candidates = items.filter((item) => {
    if (item.type !== 'imagem' || item.provider !== 'pinterest_scraping' || !item.image) return false;
    try {
      const image = new URL(item.image);
      return image.protocol === 'https:'
        && (image.hostname === 'pinimg.com' || image.hostname.endsWith('.pinimg.com'));
    } catch {
      return false;
    }
  }).slice(0, limit);
  const diagnostics = {
    enabled: true,
    configured: Boolean(env.openaiApiKey),
    requested: candidates.length,
    classified: 0,
    errors: 0
  };

  if (!env.openaiApiKey) return { items, diagnostics: { ...diagnostics, reason: 'OPENAI_API_KEY ausente' } };

  // Limita concorrência para não disparar uma chamada por resultado de busca.
  for (let offset = 0; offset < candidates.length; offset += 2) {
    const batch = candidates.slice(offset, offset + 2);
    const outcomes = await Promise.allSettled(batch.map((item) => classifyImage(item.image)));
    outcomes.forEach((outcome, index) => {
      const item = batch[index];
      if (outcome.status === 'rejected') {
        diagnostics.errors += 1;
        item.visualClassification = { status: 'error' };
        return;
      }
      const classification = outcome.value;
      diagnostics.classified += 1;
      item.visualClassification = { status: 'ok', ...classification };
      if (classification.isCrochetChart && classification.confidence >= env.visionChartThreshold) {
        item.type = 'grafico';
        item.rankingSignals = { ...item.rankingSignals, visualChartConfidence: classification.confidence };
      }
    });
  }

  return { items, diagnostics };
}
