// API handler pro seznam jízd — GET načte jízdy uživatele, POST uloží novou
const { randomUUID } = require('crypto');
const { initDb, getDb } = require('../lib/db');
const { uuidSchema, tripSchema } = require('../lib/validation');

module.exports = async function handler(req, res) {
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
 * Načte všechny jízdy daného uživatele seřazené od nejnovější.
 * userId musí být validní UUID — jinak vrátíme 400.
 */
async function handleGet(req, res) {
  const parsed = uuidSchema.safeParse(req.query.userId);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Neplatné userId' });
  }

  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT * FROM trips WHERE user_id = ? ORDER BY date DESC',
    args: [parsed.data],
  });

  return res.status(200).json(result.rows);
}

/**
 * Uloží novou jízdu do databáze a vrátí ji s vygenerovaným UUID.
 * Validuje všechna pole přes tripSchema — neúplná nebo neplatná data → 400.
 */
async function handlePost(req, res) {
  const parsed = tripSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: 'Neplatná data', details: parsed.error.flatten() });
  }

  const { userId, date, distance, consumption, price, liters, cost } =
    parsed.data;
  const id = randomUUID();
  const db = getDb();

  await db.execute({
    sql: `INSERT INTO trips (id, user_id, date, distance, consumption, price, liters, cost)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, userId, date, distance, consumption, price, liters, cost],
  });

  return res
    .status(201)
    .json({ id, userId, date, distance, consumption, price, liters, cost });
}
