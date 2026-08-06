import { env } from '../../config/env.js';
import { detectType } from '../../classification/type.js';
import { computeCrochetConfidence } from '../../classification/crochet-confidence.js';

export async function searchYouTube({ query, limit, signal }) {
  if (!env.youtubeConfigured) return { configured: false, results: [] };
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.search = new URLSearchParams({ part: 'snippet', q: query, type: 'video', maxResults: String(Math.min(limit, 50)), regionCode: env.YOUTUBE_REGION, relevanceLanguage: env.YOUTUBE_DEFAULT_LANGUAGE, videoEmbeddable: 'true', safeSearch: 'moderate', key: env.YOUTUBE_API_KEY });
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`YouTube request failed (${response.status})`);
  const body = await response.json();
  return { configured: true, results: (body.items ?? []).map((item) => {
    const targetUrl = `https://www.youtube.com/watch?v=${item.id.videoId}`;
    return {
      id: `youtube:${item.id.videoId}`, externalId: item.id.videoId,
      type: detectType(targetUrl, 'video', { title: item.snippet.title, description: item.snippet.description }),
      origin: 'youtube', title: item.snippet.title,
      description: item.snippet.description, url: targetUrl, image: item.snippet.thumbnails?.high?.url ?? item.snippet.thumbnails?.default?.url,
      author: item.snippet.channelTitle, language: env.YOUTUBE_DEFAULT_LANGUAGE, publishedAt: item.snippet.publishedAt, tags: [],
      rankingSignals: { textualRelevance: 0.8, sourceQuality: 0.8, crochetConfidence: computeCrochetConfidence(item.snippet.title, item.snippet.description), freshness: 0.7, engagement: 0.5, completeness: 0.65 }
    };
  }) };
}
