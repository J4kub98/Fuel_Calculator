// API handler pro mazání konkrétní jízdy — ověřuje vlastnictví před smazáním
const { initDb, getDb } = require('../../lib/db');
const { uuidSchema } = require('../../lib/validation');

module.exports = async function handler(req, res) {
  try {
    await initDb();

    if (req.method !== 'DELETE') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const idParsed     = uuidSchema.safeParse(req.query.id);
    const userIdParsed = uuidSchema.safeParse(req.query.userId);

    if (!idParsed.success || !userIdParsed.success) {
      return res.status(400).json({ error: 'Neplatné ID nebo userId' });
    }

    const db = getDb();

    // Ověř vlastnictví — cizí jízdu nelze smazat
    const existing = await db.execute({
      sql: 'SELECT id FROM trips WHERE id = ? AND user_id = ?',
      args: [idParsed.data, userIdParsed.data],
    });

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Jízda nenalezena' });
    }

    await db.execute({
      sql: 'DELETE FROM trips WHERE id = ? AND user_id = ?',
      args: [idParsed.data, userIdParsed.data],
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[/api/trips/[id]]', err);
    return res.status(500).json({ error: 'Interní chyba serveru' });
  }
};
