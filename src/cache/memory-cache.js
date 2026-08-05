import { LRUCache } from 'lru-cache';
import { env } from '../config/env.js';

export const memoryCache = new LRUCache({ max: 1000, ttl: env.SEARCH_CACHE_TTL_SECONDS * 1000 });
