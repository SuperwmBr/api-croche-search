function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').replace(/^m\./, '');
  } catch {
    return null;
  }
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

// Reels/posts do Instagram viram vídeo, mas um link de perfil (sem
// /p/, /reel/ ou /tv/ com um código depois) não tem o que embutir.
function isInstagramVideo(url, host) {
  if (host !== 'instagram.com') return false;
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    return (segments[0] === 'p' || segments[0] === 'reel' || segments[0] === 'tv') && Boolean(segments[1]);
  } catch {
    return false;
  }
}

// Um pin específico (foto/vídeo individual) tem uma imagem central pra
// mostrar; um board/perfil do Pinterest não, então continua como link comum.
function isPinterestPin(url, host) {
  if (host === 'pin.it') return true;
  if (host !== 'pinterest.com' && !(host && host.endsWith('.pinterest.com'))) return false;
  try {
    return new URL(url).pathname.split('/').filter(Boolean)[0] === 'pin';
  } catch {
    return false;
  }
}

// Classifica o tipo de conteúdo pela URL de destino, não pelo provedor que
// trouxe o resultado — SearXNG, por exemplo, pode apontar tanto para um
// artigo quanto para um vídeo do TikTok ou um pin do Pinterest, e o provedor
// sozinho não tem como saber isso.
export function detectType(url, fallbackType = 'artigo') {
  if (isPdf(url)) return 'pdf';
  const host = hostnameOf(url);
  if (isVideoHost(host) || isInstagramVideo(url, host)) return 'video';
  if (isPinterestPin(url, host)) return 'imagem';
  return fallbackType;
}
