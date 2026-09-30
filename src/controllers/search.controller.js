import { searchQuerySchema } from '../schemas/search-query.schema.js';
import { search } from '../services/search.service.js';
import { createSearchCollection } from '../persistence/search-collection.persistence.js';
import { enqueueSearchCollection } from '../services/search-collection.service.js';
import { env } from '../config/env.js';
export async function searchController(req, res, next) {
  try {
    const parsed = searchQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_query', details: parsed.error.flatten().fieldErrors });
    if (parsed.data.coleta_assincrona) {
      if (!env.d1Configured) return res.status(503).json({ error: 'async_collection_requires_d1' });
      const collection = await createSearchCollection(parsed.data);
      enqueueSearchCollection(collection.id);
      return res.status(202).json({
        collection: { id: collection.id, status: collection.status, statusUrl: `/api/busca/coletas/${collection.id}` },
        query: collection.query,
        results: []
      });
    }
    res.json(await search(parsed.data));
  } catch (error) { next(error); }
}
