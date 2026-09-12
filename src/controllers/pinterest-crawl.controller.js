import { z } from 'zod';
import { getPinterestCrawl, getPinterestCrawlResults } from '../persistence/pinterest-crawl.persistence.js';

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(100)
});

export async function pinterestCrawlStatusController(req, res, next) {
  try {
    const job = await getPinterestCrawl(req.params.id);
    if (!job) return res.status(404).json({ error: 'crawl_not_found' });
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_query', details: parsed.error.flatten().fieldErrors });
    const { page, limit } = parsed.data;
    const results = await getPinterestCrawlResults(job.id, { limit, offset: (page - 1) * limit });
    return res.json({
      crawl: {
        id: job.id,
        provider: job.provider,
        query: job.query,
        status: job.status,
        collectionComplete: job.status === 'complete',
        pagesCompleted: job.pagesCompleted,
        resultsCollected: job.resultsCount,
        error: job.error,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        completedAt: job.completedAt
      },
      page,
      limit,
      total: job.resultsCount,
      results
    });
  } catch (error) {
    return next(error);
  }
}
