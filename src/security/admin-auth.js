import { timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
export function adminAuth(req, res, next) {
  if (!env.ADMIN_API_KEY) return res.status(503).json({ error: 'admin_not_configured' });
  const provided = req.get('x-admin-key') ?? '';
  const expected = Buffer.from(env.ADMIN_API_KEY);
  const actual = Buffer.from(provided);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return res.status(401).json({ error: 'unauthorized' });
  next();
}
