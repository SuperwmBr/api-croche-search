import { Router } from 'express';
import { searchController } from '../controllers/search.controller.js';
import { env } from '../config/env.js';
import { adminAuth } from '../security/admin-auth.js';
import { pinterestCrawlStatusController } from '../controllers/pinterest-crawl.controller.js';

export const router = Router();
router.get('/health', (_req, res) => res.json({ status: 'ok', service: 'tutoriaiscroche-search-api', timestamp: new Date().toISOString(), integrations: { d1: env.d1Configured, youtube: env.youtubeConfigured, searxng: true, valueserp: Boolean(env.valueserpApiKey), pinterestScraping: true, meilisearch: env.meilisearchConfigured } }));
router.get('/busca', searchController);
router.get('/busca/crawls/:id', pinterestCrawlStatusController);
router.get('/busca/sugestoes', (req, res) => res.json({ query: req.query.q ?? '', suggestions: [] }));
router.get('/busca/fontes', (_req, res) => res.json({ providers: ['internal', 'youtube', 'searxng', 'valueserp', 'scraping', 'meilisearch'] }));
router.get('/conteudos/:id', (_req, res) => res.status(501).json({ error: 'not_implemented' }));
router.post('/conteudos/:id/favorito', (_req, res) => res.status(501).json({ error: 'not_implemented' }));
router.post('/conteudos/:id/avaliacao', (_req, res) => res.status(501).json({ error: 'not_implemented' }));
router.use('/admin', adminAuth);
router.all('/admin/{*path}', (_req, res) => res.status(501).json({ error: 'not_implemented' }));
