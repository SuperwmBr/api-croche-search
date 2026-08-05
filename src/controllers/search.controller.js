import { searchQuerySchema } from '../schemas/search-query.schema.js';
import { search } from '../services/search.service.js';
export async function searchController(req, res, next) {
  try {
    const parsed = searchQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_query', details: parsed.error.flatten().fieldErrors });
    res.json(await search(parsed.data));
  } catch (error) { next(error); }
}
