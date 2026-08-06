const SOURCE_DOMAINS = {
  instagram: ['instagram.com'],
  tiktok: ['tiktok.com'],
  pinterest: ['pinterest.com', 'pin.it']
};

export const SUPPORTED_SOURCES = ['internal', 'youtube', 'web', 'pdf', 'instagram', 'tiktok', 'pinterest'];

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

export function matchesSource(url, source) {
  if (source === 'web') return true;
  if (source === 'pdf') {
    try { return new URL(url).pathname.toLowerCase().endsWith('.pdf'); } catch { return false; }
  }
  const host = hostnameOf(url);
  return Boolean(host && SOURCE_DOMAINS[source]?.some((domain) => host === domain || host.endsWith(`.${domain}`)));
}

export function buildSourceQuery(query, source) {
  if (source === 'instagram') return `${query} site:instagram.com`;
  if (source === 'tiktok') return `${query} site:tiktok.com`;
  if (source === 'pinterest') return `${query} site:pinterest.com/pin`;
  if (source === 'pdf') return `${query} filetype:pdf`;
  return query;
}

export function categoriesForSource(source) {
  if (source === 'instagram' || source === 'tiktok') return 'general,videos';
  if (source === 'pinterest') return 'general,images';
  return 'general';
}
