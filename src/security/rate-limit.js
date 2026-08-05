import { env } from '../config/env.js';
const clients = new Map();
export function rateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip;
  const current = clients.get(key);
  if (!current || now >= current.resetAt) clients.set(key, { count: 1, resetAt: now + env.SEARCH_RATE_LIMIT_WINDOW_MS });
  else current.count += 1;
  const state = clients.get(key);
  res.setHeader('RateLimit-Limit', env.SEARCH_RATE_LIMIT_MAX);
  res.setHeader('RateLimit-Remaining', Math.max(0, env.SEARCH_RATE_LIMIT_MAX - state.count));
  if (state.count > env.SEARCH_RATE_LIMIT_MAX) return res.status(429).json({ error: 'rate_limit_exceeded' });
  next();
}
