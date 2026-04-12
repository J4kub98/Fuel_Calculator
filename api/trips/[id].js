// API handler pro mazání konkrétní jízdy — ověřuje vlastnictví před smazáním
const { initDb, getDb } = require('../../lib/db');
const { uuidSchema } = require('../../lib/validation');
const { getSession } = require('../../lib/session');
const { setSecurityHeaders } = require('../../lib/http');
const { checkRateLimit } = require('../../lib/rateLimit');

module.exports = async function handler(req, res) {
  setSecurityHeaders(res);

  const rate = checkRateLimit(req, `/api/trips/[id]:${req.method || 'UNKNOWN'}`);
  res.setHeader('X-RateLimit-Remaining', String(rate.remaining));
  if (!rate.ok) {
    res.setHeader('Retry-After', String(rate.retryAfter));
    return res.status(429).json({ error: 'Too many requests' });
  }

  try {
    await initDb();

    if (req.method !== 'DELETE') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const session = getSession(req);
    if (!session) {
      return res.status(401).json({ error: 'Neautorizováno' });
    }

    const idParsed = uuidSchema.safeParse(req.query.id);

    if (!idParsed.success) {
      return res.status(400).json({ error: 'Neplatné ID' });
    }

    const db = getDb();

    // Ověř vlastnictví — cizí jízdu nelze smazat
    const existing = await db.execute({
      sql: 'SELECT id FROM trips WHERE id = ? AND user_id = ?',
      args: [idParsed.data, session.userId],
    });

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Jízda nenalezena' });
    }

    await db.execute({
      sql: 'DELETE FROM trips WHERE id = ? AND user_id = ?',
      args: [idParsed.data, session.userId],
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[/api/trips/[id]]', err);
    return res.status(500).json({ error: 'Interní chyba serveru' });
  }
};
