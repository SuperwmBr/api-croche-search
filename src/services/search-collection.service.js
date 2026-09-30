import { env } from '../config/env.js';
import { search } from './search.service.js';
import {
  claimSearchCollection,
  failSearchCollection,
  listSearchCollections,
  saveSearchCollection
} from '../persistence/search-collection.persistence.js';

const activeJobs = new Set();
let workerTimer;
const jobSignal = () => AbortSignal.timeout(env.valueserpTotalTimeoutMs + env.pinterestTotalTimeoutMs + 15000);

export function enqueueSearchCollection(id) {
  if (!env.d1Configured) return;
  setTimeout(() => processSearchCollection({ id }).catch((error) => {
    console.error('[search-collection]', error?.message || error);
  }), 0).unref?.();
}

export function scheduleSearchCollectionWorker() {
  if (workerTimer || !env.d1Configured) return;
  workerTimer = setInterval(() => runSearchCollectionQueue().catch((error) => {
    console.error('[search-collection-worker]', error?.message || error);
  }), env.pinterestCrawlIntervalMs);
  workerTimer.unref?.();
  setTimeout(() => runSearchCollectionQueue().catch((error) => {
    console.error('[search-collection-worker]', error?.message || error);
  }), 500).unref?.();
}

export async function processSearchCollection({ id }) {
  if (!id || activeJobs.has(id)) return;
  activeJobs.add(id);
  const signal = jobSignal();
  try {
    const claimed = await claimSearchCollection(id, { signal });
    if (!claimed?.claimed) return;
    const output = await search({
      ...claimed.job.params,
      _collectionRun: true,
      _bypassCache: true
    });
    await saveSearchCollection(id, output, { signal });
  } catch (error) {
    await failSearchCollection(id, error?.message || 'search_collection_failed', { signal }).catch((saveError) => {
      console.error('[search-collection-worker]', saveError?.message || saveError);
    });
  } finally {
    activeJobs.delete(id);
  }
}

export async function runSearchCollectionQueue() {
  if (!env.d1Configured) return;
  const jobs = await listSearchCollections({ signal: jobSignal() });
  for (const job of jobs) await processSearchCollection({ id: job.id });
}
