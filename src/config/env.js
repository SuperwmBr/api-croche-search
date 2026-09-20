import 'dotenv/config';
import { z } from 'zod';

const emptyToUndefined = (value) => value === '' ? undefined : value;
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3200),
  PUBLIC_BASE_URL: z.string().url().optional().transform(emptyToUndefined),
  CORS_ORIGINS: z.string().default('https://icroche.com.br,https://www.icroche.com.br,https://tutoriaiscroche.com.br,https://www.tutoriaiscroche.com.br'),
  ADMIN_API_KEY: z.string().min(24).optional().transform(emptyToUndefined),
  CLOUDFLARE_ACCOUNT_ID: z.string().optional().transform(emptyToUndefined),
  CLOUDFLARE_D1_DATABASE_ID: z.string().uuid().optional().transform(emptyToUndefined),
  CLOUDFLARE_API_TOKEN: z.string().optional().transform(emptyToUndefined),
  YOUTUBE_API_KEY: z.string().optional().transform(emptyToUndefined),
  YOUTUBE_REGION: z.string().length(2).default('BR'),
  YOUTUBE_DEFAULT_LANGUAGE: z.string().default('pt'),
  SEARXNG_URL: z.string().url().default('http://127.0.0.1:8080'),
  SEARXNG_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  MEILISEARCH_HOST: z.string().url().default('http://127.0.0.1:7700'),
  MEILISEARCH_MASTER_KEY: z.string().optional().transform(emptyToUndefined),
  MEILISEARCH_INDEX: z.string().default('croche_conteudos'),
  MEILISEARCH_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  SEARCH_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  SEARCH_MAX_QUERY_LENGTH: z.coerce.number().int().min(20).max(500).default(180),
  SEARCH_PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(6000),
  SEARCH_PERSISTENCE_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  VALUESERP_API_KEY: z.string().optional().transform(emptyToUndefined),
  VALUESERP_BASE_URL: z.string().url().default('https://api.valueserp.com/search'),
  VALUESERP_SEARCH_TYPE: z.enum(['images', 'search', 'news', 'shopping']).default('images'),
  VALUESERP_GOOGLE_DOMAIN: z.string().default('google.com.br'),
  VALUESERP_GL: z.string().default('br'),
  VALUESERP_HL: z.string().default('pt-br'),
  VALUESERP_TIME_PERIOD: z.string().default('last_month'),
  VALUESERP_MAX_PAGES: z.coerce.number().int().positive().max(100).default(100),
  VALUESERP_SYNC_DEFAULT_MAX_PAGES: z.coerce.number().int().positive().max(100).default(5),
  VALUESERP_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  VALUESERP_TOTAL_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
  VALUESERP_DAILY_LIMIT: z.coerce.number().int().positive().default(200),
  PINTEREST_BASE_URL: z.string().url().default('https://www.pinterest.com'),
  PINTEREST_MAX_PAGES: z.coerce.number().int().positive().max(100).default(100),
  PINTEREST_BATCH_MAX_PAGES: z.coerce.number().int().positive().max(10).default(3),
  PINTEREST_CRAWL_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  PINTEREST_CRAWL_STALE_MS: z.coerce.number().int().positive().default(300000),
  PINTEREST_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  PINTEREST_TOTAL_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
  SEARCH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  SEARCH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  LOG_LEVEL: z.string().default('info')
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Variáveis de ambiente inválidas:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGINS.split(',').map((item) => item.trim()).filter(Boolean),
  d1Configured: Boolean(parsed.data.CLOUDFLARE_ACCOUNT_ID && parsed.data.CLOUDFLARE_D1_DATABASE_ID && parsed.data.CLOUDFLARE_API_TOKEN),
  youtubeConfigured: Boolean(parsed.data.YOUTUBE_API_KEY),
  meilisearchConfigured: Boolean(parsed.data.MEILISEARCH_MASTER_KEY),
  valueserpApiKey: parsed.data.VALUESERP_API_KEY,
  valueserpBaseUrl: parsed.data.VALUESERP_BASE_URL,
  valueserpSearchType: parsed.data.VALUESERP_SEARCH_TYPE,
  valueserpGoogleDomain: parsed.data.VALUESERP_GOOGLE_DOMAIN,
  valueserpGl: parsed.data.VALUESERP_GL,
  valueserpHl: parsed.data.VALUESERP_HL,
  valueserpTimePeriod: parsed.data.VALUESERP_TIME_PERIOD,
  valueserpMaxPages: parsed.data.VALUESERP_MAX_PAGES,
  valueserpSyncDefaultMaxPages: parsed.data.VALUESERP_SYNC_DEFAULT_MAX_PAGES,
  valueserpTimeoutMs: parsed.data.VALUESERP_TIMEOUT_MS,
  valueserpTotalTimeoutMs: parsed.data.VALUESERP_TOTAL_TIMEOUT_MS,
  valueserpDailyLimit: parsed.data.VALUESERP_DAILY_LIMIT,
  pinterestBaseUrl: parsed.data.PINTEREST_BASE_URL,
  pinterestMaxPages: parsed.data.PINTEREST_MAX_PAGES,
  pinterestBatchMaxPages: parsed.data.PINTEREST_BATCH_MAX_PAGES,
  pinterestCrawlIntervalMs: parsed.data.PINTEREST_CRAWL_INTERVAL_MS,
  pinterestCrawlStaleMs: parsed.data.PINTEREST_CRAWL_STALE_MS,
  pinterestTimeoutMs: parsed.data.PINTEREST_TIMEOUT_MS,
  pinterestTotalTimeoutMs: parsed.data.PINTEREST_TOTAL_TIMEOUT_MS
};
