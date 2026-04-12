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

    const body =
      typeof req.body === 'string'
        ? JSON.parse(req.body || '{}')
        : req.body || {};

    const forceSwitch = body.force === true;

    if (body.legacyUserId !== undefined) {
      const parsed = uuidSchema.safeParse(body.legacyUserId);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Neplatné legacyUserId' });
      }
    }

    if (forceSwitch && body.legacyUserId === undefined) {
      return res.status(400).json({ error: 'Pro force přepnutí chybí legacyUserId' });
    }

    const existing = getSession(req);
    if (existing && !forceSwitch) {
      return res.status(200).json({ userId: existing.userId, migrated: false, switched: false });
    }

    const userId = resolveOrCreateUserId(body.legacyUserId);
    const cookie = createSessionCookie(userId);

    res.setHeader('Set-Cookie', cookie);
    return res.status(200).json({
      userId,
      migrated: Boolean(body.legacyUserId),
      switched: Boolean(existing && forceSwitch),
    });
  } catch (err) {
    console.error('[/api/session]', err);
    return res.status(500).json({ error: 'Interní chyba serveru' });
  }
};
