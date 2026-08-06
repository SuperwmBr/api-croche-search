import test from 'node:test';
import assert from 'node:assert/strict';
import { detectType } from '../src/classification/type.js';
import { computeCrochetConfidence } from '../src/classification/crochet-confidence.js';

test('detecta YouTube como video', () => assert.equal(detectType('https://www.youtube.com/watch?v=abc', 'artigo'), 'video'));
test('detecta TikTok como video', () => assert.equal(detectType('https://www.tiktok.com/@user/video/123', 'artigo'), 'video'));
test('detecta Instagram reel como video', () => assert.equal(detectType('https://www.instagram.com/reel/ABC123/', 'artigo'), 'video'));
test('perfil do Instagram nao vira video', () => assert.equal(detectType('https://www.instagram.com/someuser/', 'artigo'), 'artigo'));
test('detecta pin do Pinterest como imagem', () => assert.equal(detectType('https://www.pinterest.com/pin/123456789/', 'artigo'), 'imagem'));
test('link curto pin.it vira imagem', () => assert.equal(detectType('https://pin.it/abc123', 'artigo'), 'imagem'));
test('board do Pinterest nao vira imagem', () => assert.equal(detectType('https://br.pinterest.com/user/board/', 'artigo'), 'artigo'));
test('detecta PDF mesmo com query string', () => assert.equal(detectType('https://site.com/receita.pdf?ref=x', 'artigo'), 'pdf'));
test('mantem fallback quando nao reconhece a plataforma', () => assert.equal(detectType('https://blog.com/post', 'artigo'), 'artigo'));
test('url invalida cai no fallback', () => assert.equal(detectType('não é uma url', 'video'), 'video'));

test('crochetConfidence alta quando o texto menciona croche', () =>
  assert.ok(computeCrochetConfidence('Flor de crochê fácil', 'Aprenda a fazer passo a passo') >= 0.5));
test('crochetConfidence baixa quando o texto nao tem relacao com croche', () =>
  assert.ok(computeCrochetConfidence('Copom corta taxa de juros', 'Selic cai 0,25 ponto') < 0.5));
test('crochetConfidence reconhece termos especificos sem a palavra croche', () =>
  assert.ok(computeCrochetConfidence('Anel mágico para amigurumi', '') >= 0.5));
test('crochetConfidence ignora acentuacao', () => assert.ok(computeCrochetConfidence('CROCHÊ facil', '') >= 0.5));
