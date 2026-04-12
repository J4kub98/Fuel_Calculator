const {
  createSessionCookie,
  getSession,
  resolveOrCreateUserId,
} = require('../lib/session');
const { uuidSchema } = require('../lib/validation');
const { setSecurityHeaders } = require('../lib/http');
const { checkRateLimit } = require('../lib/rateLimit');

module.exports = async function handler(req, res) {
  try {
    setSecurityHeaders(res);

    const rate = checkRateLimit(req, '/api/session');
    res.setHeader('X-RateLimit-Remaining', String(rate.remaining));
    if (!rate.ok) {
      res.setHeader('Retry-After', String(rate.retryAfter));
      return res.status(429).json({ error: 'Too many requests' });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const existing = getSession(req);
    if (existing) {
      return res.status(200).json({ userId: existing.userId, migrated: false });
    }

    const body =
      typeof req.body === 'string'
        ? JSON.parse(req.body || '{}')
        : req.body || {};

    if (body.legacyUserId !== undefined) {
      const parsed = uuidSchema.safeParse(body.legacyUserId);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Neplatné legacyUserId' });
      }
    }

    const userId = resolveOrCreateUserId(body.legacyUserId);
    const cookie = createSessionCookie(userId);

    res.setHeader('Set-Cookie', cookie);
    return res.status(200).json({ userId, migrated: Boolean(body.legacyUserId) });
  } catch (err) {
    console.error('[/api/session]', err);
    return res.status(500).json({ error: 'Interní chyba serveru' });
  }
};
