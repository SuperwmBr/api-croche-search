import test from 'node:test';
import assert from 'node:assert/strict';
import { env } from '../src/config/env.js';
import { searchYouTube } from '../src/providers/youtube/youtube.provider.js';

test('YouTube segue os tokens até o limite de seis páginas na coleta completa', async () => {
  const originalFetch = globalThis.fetch;
  const originalConfigured = env.youtubeConfigured;
  const originalKey = env.YOUTUBE_API_KEY;
  env.youtubeConfigured = true;
  env.YOUTUBE_API_KEY = 'test-key';
  const tokens = [];
  globalThis.fetch = async (url) => {
    const parsed = new URL(url);
    const token = parsed.searchParams.get('pageToken');
    tokens.push(token);
    const page = tokens.length;
    return {
      ok: true,
      json: async () => ({
        items: [{
          id: { videoId: `video-${page}` },
          snippet: { title: `Crochet chart ${page}`, description: 'Crochet chart tutorial', channelTitle: 'Crochet', publishedAt: '2026-01-01T00:00:00Z', thumbnails: {} }
        }],
        nextPageToken: page < 8 ? `token-${page}` : undefined
      })
    };
  };
  try {
    const output = await searchYouTube({ query: 'crochet chart', limit: 250, allPages: true, maxPages: 6 });
    assert.equal(tokens.length, 6);
    assert.equal(tokens[0], null);
    assert.equal(tokens[1], 'token-1');
    assert.equal(output.results.length, 6);
    assert.equal(output.diagnostics.pagesCompleted, 6);
    assert.equal(output.diagnostics.hasMore, true);
    assert.equal(output.partial, true);
  } finally {
    globalThis.fetch = originalFetch;
    env.youtubeConfigured = originalConfigured;
    env.YOUTUBE_API_KEY = originalKey;
  }
});

test('YouTube preserva páginas concluídas quando uma página posterior falha', async () => {
  const originalFetch = globalThis.fetch;
  const originalConfigured = env.youtubeConfigured;
  const originalKey = env.YOUTUBE_API_KEY;
  env.youtubeConfigured = true;
  env.YOUTUBE_API_KEY = 'test-key';
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 2) return { ok: false, status: 503 };
    return {
      ok: true,
      json: async () => ({
        items: [{
          id: { videoId: 'video-1' },
          snippet: { title: 'Crochet chart', description: 'Crochet diagram', channelTitle: 'Crochet', thumbnails: {} }
        }],
        nextPageToken: 'token-1'
      })
    };
  };
  try {
    const output = await searchYouTube({ query: 'crochet chart', limit: 250, allPages: true, maxPages: 6 });
    assert.equal(output.results.length, 1);
    assert.equal(output.diagnostics.pagesCompleted, 1);
    assert.equal(output.diagnostics.hasMore, true);
    assert.equal(output.partial, true);
    assert.match(output.diagnostics.error, /YouTube request failed/);
  } finally {
    globalThis.fetch = originalFetch;
    env.youtubeConfigured = originalConfigured;
    env.YOUTUBE_API_KEY = originalKey;
  }
});
