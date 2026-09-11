const DEFAULT_KEY = 'global';

function clientIp(req) {
  return req.ip
    ?? req.socket?.remoteAddress
    ?? req.connection?.remoteAddress
    ?? DEFAULT_KEY;
}

export function createFixedWindowRateLimiter({
  windowMs,
  max,
  keyPrefix,
  keyGenerator = clientIp,
  message = 'Too many requests. Please try again later.',
}) {
  if (!Number.isInteger(windowMs) || windowMs <= 0) {
    throw new Error('Rate limiter windowMs must be a positive integer.');
  }

  if (!Number.isInteger(max) || max <= 0) {
    throw new Error('Rate limiter max must be a positive integer.');
  }

  const store = new Map();

  return function fixedWindowRateLimiter(req, res, next) {
    const now = Date.now();
    const key = `${keyPrefix}:${keyGenerator(req) ?? DEFAULT_KEY}`;
    const existing = store.get(key);
    const bucket = existing && existing.resetAt > now
      ? existing
      : { count: 0, resetAt: now + windowMs };

    bucket.count += 1;
    store.set(key, bucket);

    const remaining = Math.max(max - bucket.count, 0);
    const resetSeconds = Math.max(Math.ceil((bucket.resetAt - now) / 1000), 0);

    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(resetSeconds));

    if (bucket.count > max) {
      res.setHeader('Retry-After', String(resetSeconds));
      res.status(429).json({ error: message });
      return;
    }

    next();
  };
}
