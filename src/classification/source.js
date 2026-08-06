const SOURCE_DOMAINS = {
  instagram: ['instagram.com'],
  tiktok: ['tiktok.com'],
  pinterest: ['pinterest.com', 'pin.it']
};

export const SUPPORTED_SOURCES = ['internal', 'youtube', 'web', 'pdf', 'instagram', 'tiktok', 'pinterest'];

const compact = (value) => value.replace(/\s+/g, ' ').trim();
const normalized = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

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
  if (source === 'web') return sourceFromUrl(url, 'web') === 'web';
  if (source === 'pdf') {
    try { return new URL(url).pathname.toLowerCase().endsWith('.pdf'); } catch { return false; }
  }
  const host = hostnameOf(url);
  return Boolean(host && SOURCE_DOMAINS[source]?.some((domain) => host === domain || host.endsWith(`.${domain}`)));
}

function sourceOperator(source) {
  if (source === 'instagram') return 'site:instagram.com';
  if (source === 'tiktok') return 'site:tiktok.com';
  if (source === 'pinterest') return 'site:pinterest.com/pin';
  if (source === 'pdf') return 'filetype:pdf';
  return '';
}

function relaxQuery(query) {
  return compact(query
    .replace(/\b(tutorial\s+completo|passo\s+a\s+passo\s+completo|completo|completa|f[aá]cil|r[aá]pido|r[aá]pida|para\s+iniciantes?|iniciante|beginner(?:s)?|easy|complete)\b/gi, ' '));
}

function toPortuguese(query) {
  return compact(query
    .replace(/\bcrochet\s+flowers?\b/gi, 'flor de crochê')
    .replace(/\bcrochet\b/gi, 'crochê')
    .replace(/\bflowers?\b/gi, 'flor')
    .replace(/\bstep\s+by\s+step\b/gi, 'passo a passo')
    .replace(/\btutorial\b/gi, 'passo a passo')
    .replace(/\bbeginners?\b/gi, 'iniciante'));
}

function toEnglish(query) {
  return compact(query
    .replace(/flores?\s+de\s+croch[eê](?=\s|$|[.,;:!?])/gi, 'crochet flower')
    .replace(/croch[eê](?=\s|$|[.,;:!?])/gi, 'crochet')
    .replace(/flores?(?=\s|$|[.,;:!?])/gi, 'flower')
    .replace(/passo\s+a\s+passo(?=\s|$|[.,;:!?])/gi, 'tutorial')
    .replace(/iniciantes?(?=\s|$|[.,;:!?])/gi, 'beginner'));
}

export function buildSourceQuery(query, source) {
  const operator = sourceOperator(source);
  return operator ? `${compact(query)} ${operator}` : compact(query);
}

export function buildSourceQueries(query, source, maxVariants = 4) {
  const base = compact(query);
  const variants = new Set([base]);

  if (source === 'tiktok' || source === 'instagram') {
    const relaxed = relaxQuery(base);
    if (relaxed.length >= 3) variants.add(relaxed);

    const language = normalized(base);
    if (/\b(crochet|flower|tutorial|step by step|beginner)\b/.test(language)) {
      variants.add(toPortuguese(base));
      variants.add(toPortuguese(relaxed));
    } else {
      variants.add(toEnglish(base));
      variants.add(toEnglish(relaxed));
    }
  }

  return [...variants]
    .filter((value) => value.length >= 3)
    .slice(0, Math.max(1, maxVariants))
    .map((value) => buildSourceQuery(value, source));
}

export function categoriesForSource(source) {
  if (source === 'instagram' || source === 'tiktok') return 'general,videos';
  if (source === 'pinterest') return 'general,images';
  return 'general';
}
