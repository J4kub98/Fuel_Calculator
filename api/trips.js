// API handler pro seznam jízd — GET načte jízdy uživatele, POST uloží novou
const { randomUUID } = require('crypto');
const { initDb, getDb } = require('../lib/db');
const { tripSchema } = require('../lib/validation');
const { getSession } = require('../lib/session');
const { setSecurityHeaders } = require('../lib/http');
const { checkRateLimit } = require('../lib/rateLimit');

module.exports = async function handler(req, res) {
  setSecurityHeaders(res);

  const rate = checkRateLimit(req, `/api/trips:${req.method || 'UNKNOWN'}`);
  res.setHeader('X-RateLimit-Remaining', String(rate.remaining));
  if (!rate.ok) {
    res.setHeader('Retry-After', String(rate.retryAfter));
    return res.status(429).json({ error: 'Too many requests' });
  }

  try {
    await initDb();
    if (req.method === 'GET') return handleGet(req, res);
    if (req.method === 'POST') return handlePost(req, res);
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[/api/trips]', err);
    return res.status(500).json({ error: 'Interní chyba serveru' });
  }
};

/**
 * Načte všechny jízdy přihlášeného uživatele seřazené od nejnovější.
 */
async function handleGet(req, res) {
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ error: 'Neautorizováno' });
  }

  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT * FROM trips WHERE user_id = ? ORDER BY date DESC',
    args: [session.userId],
  });

  return res.status(200).json(result.rows);
}

/**
 * Uloží novou jízdu do databáze a vrátí ji s vygenerovaným UUID.
 * Validuje všechna pole přes tripSchema — neúplná nebo neplatná data → 400.
 */
async function handlePost(req, res) {
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ error: 'Neautorizováno' });
  }

  const body =
    typeof req.body === 'string'
      ? JSON.parse(req.body || '{}')
      : req.body || {};

  const parsed = tripSchema.safeParse(body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: 'Neplatná data', details: parsed.error.flatten() });
  }

  const { date, distance, consumption, price, liters, cost } = parsed.data;
  const id = randomUUID();
  const db = getDb();

  await db.execute({
    sql: `INSERT INTO trips (id, user_id, date, distance, consumption, price, liters, cost)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, session.userId, date, distance, consumption, price, liters, cost],
  });

  return res.status(201).json({
    id,
    date,
    distance,
    consumption,
    price,
    liters,
    cost,
  });
}
