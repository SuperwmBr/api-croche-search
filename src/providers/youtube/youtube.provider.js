import { env } from '../../config/env.js';
import { detectType } from '../../classification/type.js';
import { computeCrochetConfidence } from '../../classification/crochet-confidence.js';

export async function searchYouTube({ query, limit, signal, allPages = false, maxPages = 1 }) {
  if (!env.youtubeConfigured) return { configured: false, results: [] };
  const pageLimit = Math.min(Math.max(1, Number(maxPages) || 1), 6);
  const results = [];
  let pageToken = null;
  let pagesCompleted = 0;
  let hasMore = false;
  while (pagesCompleted < (allPages ? pageLimit : 1)) {
    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    const params = new URLSearchParams({ part: 'snippet', q: query, type: 'video', maxResults: String(Math.min(limit, 50)), regionCode: env.YOUTUBE_REGION, relevanceLanguage: env.YOUTUBE_DEFAULT_LANGUAGE, videoEmbeddable: 'true', safeSearch: 'moderate', key: env.YOUTUBE_API_KEY });
    if (pageToken) params.set('pageToken', pageToken);
    url.search = params;
    let response;
    let body;
    try {
      response = await fetch(url, { signal });
      if (!response.ok) throw new Error(`YouTube request failed (${response.status})`);
      body = await response.json();
    } catch (error) {
      if (pagesCompleted === 0) throw error;
      return { configured: true, partial: true, diagnostics: { pagesCompleted, maxPages: pageLimit, hasMore: true, error: error?.message || 'youtube_page_failed' }, results };
    }
    pagesCompleted += 1;
    results.push(...(body.items ?? []).map((item) => {
      const targetUrl = `https://www.youtube.com/watch?v=${item.id.videoId}`;
      return {
        id: `youtube:${item.id.videoId}`, externalId: item.id.videoId,
        type: detectType(targetUrl, 'video', { title: item.snippet.title, description: item.snippet.description }),
        origin: 'youtube', title: item.snippet.title,
        description: item.snippet.description, url: targetUrl, image: item.snippet.thumbnails?.high?.url ?? item.snippet.thumbnails?.default?.url,
        author: item.snippet.channelTitle, language: env.YOUTUBE_DEFAULT_LANGUAGE, publishedAt: item.snippet.publishedAt, tags: [],
        rankingSignals: { textualRelevance: 0.8, sourceQuality: 0.8, crochetConfidence: computeCrochetConfidence(item.snippet.title, item.snippet.description), freshness: 0.7, engagement: 0.5, completeness: 0.65 }
      };
    }));
    pageToken = body.nextPageToken || null;
    hasMore = Boolean(pageToken);
    if (!allPages || !pageToken) break;
  }
  return { configured: true, partial: allPages && hasMore, diagnostics: { pagesCompleted, maxPages: pageLimit, hasMore }, results };
}
