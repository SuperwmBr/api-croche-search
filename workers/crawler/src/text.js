// Portado de src/normalization/text.js (api-croche-search) sem alterações de lógica.
// Duplicado de propósito: o worker não importa nada de fora de workers/crawler/.

export function normalizeText(value = '') {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function canonicalizeUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith('utm_') || ['gclid', 'fbclid', 'ref'].includes(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    url.pathname = url.pathname.replace(/\/$/, '') || '/';
    return url.toString();
  } catch {
    return value;
  }
}

// sha256 hex via WebCrypto (nativo no runtime do Workers, sem precisar de
// node:crypto nem da flag nodejs_compat). Equivalente ao createHash('sha256')
// usado em search-results.persistence.js, só que assíncrono.
export async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
