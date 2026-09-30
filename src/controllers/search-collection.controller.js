import { z } from 'zod';
import { getSearchCollection } from '../persistence/search-collection.persistence.js';

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(250).default(100)
});

export async function searchCollectionController(req, res, next) {
  try {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_query', details: parsed.error.flatten().fieldErrors });
    const result = await getSearchCollection(req.params.id, parsed.data);
    if (!result) return res.status(404).json({ error: 'search_collection_not_found' });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
}
