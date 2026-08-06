function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').replace(/^m\./, '');
  } catch {
    return null;
  }
}

function normalize(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isPdf(url) {
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.pdf');
  } catch {
    return false;
  }
}

function isVideoHost(host) {
  if (!host) return false;
  if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'youtu.be') return true;
  if (host === 'vimeo.com') return true;
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return true;
  return false;
}

function isInstagramVideo(url, host) {
  if (host !== 'instagram.com') return false;
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    return (segments[0] === 'p' || segments[0] === 'reel' || segments[0] === 'tv') && Boolean(segments[1]);
  } catch {
    return false;
  }
}

function isPinterestPin(url, host) {
  if (host === 'pin.it') return true;
  if (host !== 'pinterest.com' && !(host && host.endsWith('.pinterest.com'))) return false;
  try {
    return new URL(url).pathname.split('/').filter(Boolean)[0] === 'pin';
  } catch {
    return false;
  }
}

const GRAPHIC_TERMS = [
  'grafico de croche',
  'graficos de croche',
  'diagrama de croche',
  'diagramas de croche',
  'receita grafica',
  'receitas graficas',
  'esquema de croche',
  'esquemas de croche',
  'crochet chart',
  'crochet charts',
  'crochet diagram',
  'crochet diagrams',
  'stitch chart',
  'symbol chart',
  'chart pattern'
];

const GRAPHIC_COLLECTION_TERMS = [
  'croche e graficos',
  'croche graficos',
  'graficosdecroche',
  'graficos croche',
  'diagramas croche'
];

const GRAPHIC_DOCUMENT_TERMS = [
  'grafico 1',
  'grafico 2',
  'grafico 3',
  'diagrama 1',
  'diagrama 2',
  'diagrama 3',
  'legenda croche',
  'legenda do grafico',
  'sentido do trabalho',
  'inicio do trabalho',
  'ponto fantasia'
];

const GRAPHIC_EXPLANATION_TERMS = [
  'como ler',
  'como interpretar',
  'aprenda a ler',
  'aprenda a interpretar',
  'dicas para interpretar',
  'dicas essenciais para interpretar',
  'interpretar graficos',
  'leitura de graficos',
  'o que e grafico'
];

function graphicEvidence(url, metadata = {}) {
  const title = normalize(metadata.title);
  const description = normalize(metadata.description);
  const tags = Array.isArray(metadata.tags) ? metadata.tags.map(normalize).join(' ') : normalize(metadata.tags);
  const urlText = normalize(url);
  const text = `${title} ${description} ${tags} ${urlText}`;
  const directTerm = GRAPHIC_TERMS.some((term) => text.includes(term));
  const collectionTerm = GRAPHIC_COLLECTION_TERMS.some((term) => text.includes(term));
  const documentTerm = GRAPHIC_DOCUMENT_TERMS.some((term) => text.includes(term));
  const explanationOnly = GRAPHIC_EXPLANATION_TERMS.some((term) => title.includes(term))
    || /\b(como|dicas|aprenda|guia)\b.*\b(ler|leitura|interpret)/.test(title);
  const hasCrochetContext = /\b(croche|crochet|amigurumi|ponto|square|receita|pattern)\b/.test(text);
  const host = hostnameOf(url);
  const collectionHost = host === 'instagram.com' || host === 'slideshare.net' || host === 'pinterest.com' || Boolean(host?.endsWith('.pinterest.com'));
  const looksLikeCollection = collectionHost && collectionTerm;
  const looksLikeDocument = isPdf(url) && hasCrochetContext && (directTerm || documentTerm);
  return (directTerm && hasCrochetContext && !explanationOnly) || looksLikeCollection || looksLikeDocument;
}

export const SUPPORTED_TYPES = ['artigo', 'video', 'imagem', 'pdf', 'grafico'];

export function detectType(url, fallbackType = 'artigo', metadata = {}) {
  const host = hostnameOf(url);

  // Conteúdo audiovisual continua sendo vídeo, mesmo que ensine a ler gráficos.
  if (isVideoHost(host) || isInstagramVideo(url, host)) return 'video';

  // "Gráfico" é um tipo semântico próprio e prevalece sobre PDF/imagem quando
  // o título, descrição, tags ou URL identificam uma ficha/diagrama de execução.
  if (graphicEvidence(url, metadata)) return 'grafico';

  if (isPdf(url)) return 'pdf';
  if (isPinterestPin(url, host)) return 'imagem';
  return fallbackType;
}
