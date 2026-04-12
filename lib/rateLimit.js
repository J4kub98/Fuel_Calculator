const { getClientIp } = require('./http');

const buckets = new Map();

function checkRateLimit(req, key, options = {}) {
  if (process.env.NODE_ENV === 'test') {
    return { ok: true, remaining: Number.MAX_SAFE_INTEGER, retryAfter: 0 };
  }

  const limit = Number(options.limit || process.env.RATE_LIMIT_MAX || 120);
  const windowMs = Number(
    options.windowMs || process.env.RATE_LIMIT_WINDOW_MS || 60_000
  );

  const ip = getClientIp(req);
  const now = Date.now();
  const bucketKey = `${key}:${ip}`;

  const previous = buckets.get(bucketKey);
  const active =
    previous && previous.resetAt > now
      ? previous
      : { count: 0, resetAt: now + windowMs };

  active.count += 1;
  buckets.set(bucketKey, active);

  if (active.count > limit) {
    return {
      ok: false,
      remaining: 0,
      retryAfter: Math.max(1, Math.ceil((active.resetAt - now) / 1000)),
    };
  }

  return {
    ok: true,
    remaining: Math.max(0, limit - active.count),
    retryAfter: 0,
  };
}

module.exports = { checkRateLimit };
