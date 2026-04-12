/**
 * Databázová vrstva pro Turso — správa připojení a inicializace schématu.
 * Uses singleton pattern pro reuse při warm start Vercel serverless funkcí.
 */

const { createClient } = require('@libsql/client');

let client = null;

/**
 * Singleton instance Turso klienta.
 * Znovu používá stávající připojení při warm start Vercel funkcí.
 */
function getDb() {
  if (!client) {
    if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
      throw new Error(
        'Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN environment variables'
      );
    }
    client = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return client;
}

/**
 * Inicializuje databázové schéma — vytvoří tabulky a indexy pokud neexistují.
 * Bezpečné volat opakovaně, CREATE TABLE IF NOT EXISTS je idempotentní.
 */
async function initDb() {
  const db = getDb();

  // Vytvoř trips tabulku s všemi potřebnými sloupci
  await db.execute(`
    CREATE TABLE IF NOT EXISTS trips (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      date        TEXT NOT NULL,
      distance    REAL NOT NULL,
      consumption REAL NOT NULL,
      price       REAL NOT NULL,
      liters      REAL NOT NULL,
      cost        REAL NOT NULL,
      created_at  TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Vytvoř index na user_id pro efektivní filtrování záznamů uživatele
  await db.execute(
    'CREATE INDEX IF NOT EXISTS idx_trips_user ON trips(user_id)'
  );

  // Vytvoř index na date pro řazení a filtrování podle data
  await db.execute(
    'CREATE INDEX IF NOT EXISTS idx_trips_date ON trips(date)'
  );
}

module.exports = { getDb, initDb };
