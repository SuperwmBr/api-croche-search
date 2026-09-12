import { env } from '../config/env.js';
import { searchPinterest } from '../providers/pinterest/pinterest.provider.js';
import { persistSearchResults } from '../persistence/search-results.persistence.js';
import {
  claimPinterestCrawl,
  failPinterestCrawl,
  listRunnablePinterestCrawls,
  savePinterestCrawlBatch
} from '../persistence/pinterest-crawl.persistence.js';

const activeJobs = new Set();
let workerTimer;

function crawlSignal() {
  return AbortSignal.timeout(env.pinterestTotalTimeoutMs);
}

export function schedulePinterestCrawlWorker() {
  if (workerTimer || !env.d1Configured) return;
  workerTimer = setInterval(() => runPinterestCrawlQueue().catch((error) => {
    console.error('[pinterest-crawl-worker]', error?.message || error);
  }), env.pinterestCrawlIntervalMs);
  workerTimer.unref?.();
  setTimeout(() => runPinterestCrawlQueue().catch((error) => {
    console.error('[pinterest-crawl-worker]', error?.message || error);
  }), 250);
}

export function enqueuePinterestCrawl() {
  if (!env.d1Configured) return;
  setTimeout(() => runPinterestCrawlQueue().catch((error) => {
    console.error('[pinterest-crawl-worker]', error?.message || error);
  }), 0).unref?.();
}

export async function processPinterestCrawlBatch(job) {
  if (!job || activeJobs.has(job.id)) return null;
  activeJobs.add(job.id);
  try {
    const claimed = await claimPinterestCrawl(job.id, { signal: crawlSignal() });
    if (!claimed?.claimed) return claimed?.job || null;
    const current = claimed.job;
    const remaining = current.params.maxPages ? Math.max(1, current.params.maxPages - current.pagesCompleted) : current.params.batchPages;
    const maxPages = Math.min(current.params.batchPages, remaining, env.pinterestBatchMaxPages);
    const output = await searchPinterest({
      query: current.query,
      limit: current.params.limit,
      bookmark: current.nextBookmark,
      allPages: true,
      maxPages,
      signal: crawlSignal()
    });
    const persistence = await persistSearchResults(output.results, { signal: crawlSignal() });
    return await savePinterestCrawlBatch(current.id, {
      nextBookmark: output.diagnostics?.nextBookmark,
      hasMore: output.diagnostics?.hasMore,
      pagesCompleted: output.diagnostics?.pagesCompleted,
      persisted: persistence.persisted,
      canonicalUrls: persistence.canonicalUrls,
      error: output.diagnostics?.error,
      signal: crawlSignal()
    });
  } catch (error) {
    await failPinterestCrawl(job.id, error?.message || 'pinterest_crawl_failed', { signal: crawlSignal() }).catch((persistError) => {
      console.error('[pinterest-crawl-worker]', persistError?.message || persistError);
    });
    return null;
  } finally {
    activeJobs.delete(job.id);
  }
}

export async function runPinterestCrawlQueue() {
  if (!env.d1Configured) return;
  const jobs = await listRunnablePinterestCrawls({ signal: crawlSignal() });
  for (const job of jobs) await processPinterestCrawlBatch(job);
}
