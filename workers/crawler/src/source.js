// Subconjunto de src/classification/source.js (api-croche-search).
// O worker só precisa de sourceFromUrl (usado pelos providers pra classificar
// origin); as funções de expansão de query multi-fonte (buildSourceQueries
// etc.) não se aplicam aqui, já que o worker roda queries fixas/derivadas,
// não a busca interativa do usuário.

export function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').replace(/^m\./, '');
  } catch {
    return null;
  }
}

export function sourceFromUrl(url, fallback = 'web') {
  const host = hostnameOf(url);
  if (!host) return fallback;
  if (host === 'youtube.com' || host === 'youtu.be' || host.endsWith('.youtube.com')) return 'youtube';
  if (host === 'instagram.com' || host.endsWith('.instagram.com')) return 'instagram';
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return 'tiktok';
  if (host === 'pin.it' || host === 'pinterest.com' || host.endsWith('.pinterest.com')) return 'pinterest';
  try {
    if (new URL(url).pathname.toLowerCase().endsWith('.pdf')) return 'pdf';
  } catch {}
  return fallback;
}
