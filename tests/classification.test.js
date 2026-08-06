import test from 'node:test';
import assert from 'node:assert/strict';
import { detectType, SUPPORTED_TYPES } from '../src/classification/type.js';
import { computeCrochetConfidence } from '../src/classification/crochet-confidence.js';

test('detecta YouTube como video', () => assert.equal(detectType('https://www.youtube.com/watch?v=abc', 'artigo'), 'video'));
test('video sobre graficos continua como video', () => assert.equal(
  detectType('https://www.youtube.com/watch?v=abc', 'artigo', { title: 'Como ler gráficos de crochê' }),
  'video'
));
test('detecta TikTok como video', () => assert.equal(detectType('https://www.tiktok.com/@user/video/123', 'artigo'), 'video'));
test('detecta Instagram reel como video', () => assert.equal(detectType('https://www.instagram.com/reel/ABC123/', 'artigo'), 'video'));
test('perfil do Instagram nao vira video', () => assert.equal(detectType('https://www.instagram.com/someuser/', 'artigo'), 'artigo'));
test('perfil especializado em graficos vira grafico', () => assert.equal(
  detectType('https://www.instagram.com/_graficosdecroche/', 'artigo', { title: 'Gráficos de crochê' }),
  'grafico'
));
test('detecta pin do Pinterest como imagem', () => assert.equal(detectType('https://www.pinterest.com/pin/123456789/', 'artigo'), 'imagem'));
test('pin com diagrama de croche vira grafico', () => assert.equal(
  detectType('https://br.pinterest.com/pin/123456789/', 'artigo', { title: 'Diagrama de crochê para blusa' }),
  'grafico'
));
test('board de graficos do Pinterest vira grafico', () => assert.equal(
  detectType('https://br.pinterest.com/foliveira2921/croche-e-graficos/', 'artigo'),
  'grafico'
));
test('link curto pin.it vira imagem', () => assert.equal(detectType('https://pin.it/abc123', 'artigo'), 'imagem'));
test('board comum do Pinterest nao vira imagem', () => assert.equal(detectType('https://br.pinterest.com/user/board/', 'artigo'), 'artigo'));
test('PDF com diagrama vira grafico', () => assert.equal(
  detectType('https://www.circulo.com.br/storage/receitas/modelo.pdf', 'artigo', { title: 'Diagrama 1 - Square', description: 'Legenda crochê e sentido do trabalho' }),
  'grafico'
));
test('detecta PDF comum mesmo com query string', () => assert.equal(detectType('https://site.com/receita.pdf?ref=x', 'artigo'), 'pdf'));
test('artigo que ensina interpretar graficos continua artigo', () => assert.equal(
  detectType('https://www.circulo.com.br/post/graficos-de-croche-5-dicas-essenciais-para-interpreta-los', 'artigo', { title: 'Gráficos de crochê: 5 dicas essenciais para interpretá-los' }),
  'artigo'
));
test('slideshare de graficos vira grafico', () => assert.equal(
  detectType('https://pt.slideshare.net/slideshow/90-grficos-de-croch/120234866', 'artigo', { title: '90 Gráficos de Crochê' }),
  'grafico'
));
test('mantem fallback quando nao reconhece a plataforma', () => assert.equal(detectType('https://blog.com/post', 'artigo'), 'artigo'));
test('url invalida cai no fallback', () => assert.equal(detectType('não é uma url', 'video'), 'video'));
test('grafico esta entre os tipos suportados', () => assert.ok(SUPPORTED_TYPES.includes('grafico')));

test('crochetConfidence alta quando o texto menciona croche', () =>
  assert.ok(computeCrochetConfidence('Flor de crochê fácil', 'Aprenda a fazer passo a passo') >= 0.5));
test('crochetConfidence baixa quando o texto nao tem relacao com croche', () =>
  assert.ok(computeCrochetConfidence('Copom corta taxa de juros', 'Selic cai 0,25 ponto') < 0.5));
test('crochetConfidence reconhece termos especificos sem a palavra croche', () =>
  assert.ok(computeCrochetConfidence('Anel mágico para amigurumi', '') >= 0.5));
test('crochetConfidence ignora acentuacao', () => assert.ok(computeCrochetConfidence('CROCHÊ facil', '') >= 0.5));
