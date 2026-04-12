# Turso Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Přidat Turso (libSQL) backend ke kalkulátoru paliva, anonymní UUID identifikaci uživatelů, a připravit projekt na GitHub + Vercel deploy.

**Architecture:** Stávající HTML se přesune do `public/index.html` s minimálními změnami (localStorage → fetch). Backend jsou Vercel Serverless Functions v `api/`. Databáze je Turso (SQLite-kompatibilní, funguje serverless). Každý uživatel je identifikován UUID v4 uloženým v localStorage.

**Tech Stack:** Node.js (CJS), Vercel Serverless Functions, Turso (`@libsql/client`), Zod (validace), Jest (testy)

---

## Struktura souborů

```
fuel-tool/
├── public/
│   └── index.html              ← přesunout + upravit (localStorage → API)
├── api/
│   ├── trips.js                ← GET /api/trips + POST /api/trips
│   └── trips/
│       └── [id].js             ← DELETE /api/trips/:id
├── lib/
│   ├── db.js                   ← Turso klient + initDb()
│   └── validation.js           ← Zod schémata (uuidSchema, tripSchema)
├── __tests__/
│   ├── validation.test.js      ← testy validačních schémat
│   ├── trips-get-post.test.js  ← testy GET + POST handleru
│   └── trips-delete.test.js    ← testy DELETE handleru
├── package.json
├── .env.example                ← šablona env proměnných (v gitu)
├── .gitignore
└── README.md
```

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `public/` (přesunout stávající HTML)

- [ ] **Step 1: Inicializuj npm projekt**

```bash
cd "d:/Weby/Fuel tool"
npm init -y
```

- [ ] **Step 2: Nainstaluj závislosti**

```bash
npm install @libsql/client zod
npm install --save-dev jest
```

- [ ] **Step 3: Uprav package.json**

Nahraď celý obsah `package.json`:

```json
{
  "name": "fuel-tool",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "vercel dev",
    "test": "jest",
    "test:watch": "jest --watch"
  },
  "jest": {
    "testEnvironment": "node"
  },
  "dependencies": {
    "@libsql/client": "^0.14.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "jest": "^29.7.0"
  }
}
```

- [ ] **Step 4: Vytvoř .gitignore**

```
node_modules/
.env
.env.local
.env.*.local
.vercel/
*.db
```

- [ ] **Step 5: Vytvoř .env.example**

```
TURSO_DATABASE_URL=libsql://your-db-name.turso.io
TURSO_AUTH_TOKEN=your-auth-token-here
```

- [ ] **Step 6: Vytvoř složku public a přesuň HTML**

```bash
mkdir public
mv "kalkulator-paliva.html" "public/index.html"
```

- [ ] **Step 7: Commit**

```bash
git init
git add package.json package-lock.json .gitignore .env.example
git commit -m "chore: inicializace projektu, závislosti, gitignore"
```

---

## Task 2: Validační vrstva (lib/validation.js)

**Files:**
- Create: `lib/validation.js`
- Create: `__tests__/validation.test.js`

- [ ] **Step 1: Napiš failing testy**

Vytvoř `__tests__/validation.test.js`:

```javascript
// Testy Zod validačních schémat pro API vstupní data
const { uuidSchema, tripSchema } = require('../lib/validation');

describe('uuidSchema', () => {
  it('přijme platné UUID v4', () => {
    const result = uuidSchema.safeParse('550e8400-e29b-41d4-a716-446655440000');
    expect(result.success).toBe(true);
  });

  it('odmítne náhodný string', () => {
    const result = uuidSchema.safeParse('not-a-uuid');
    expect(result.success).toBe(false);
  });

  it('odmítne UUID v1 (třetí skupina nezačíná 4)', () => {
    const result = uuidSchema.safeParse('550e8400-e29b-11d4-a716-446655440000');
    expect(result.success).toBe(false);
  });

  it('odmítne prázdný string', () => {
    const result = uuidSchema.safeParse('');
    expect(result.success).toBe(false);
  });
});

describe('tripSchema', () => {
  const valid = {
    userId: '550e8400-e29b-41d4-a716-446655440000',
    date: '2026-04-12T10:00:00.000Z',
    distance: 150,
    consumption: 5.9,
    price: 38.5,
    liters: 8.85,
    cost: 340.73,
  };

  it('přijme platná data jízdy', () => {
    expect(tripSchema.safeParse(valid).success).toBe(true);
  });

  it('odmítne zápornou vzdálenost', () => {
    expect(tripSchema.safeParse({ ...valid, distance: -1 }).success).toBe(false);
  });

  it('odmítne nulovou spotřebu', () => {
    expect(tripSchema.safeParse({ ...valid, consumption: 0 }).success).toBe(false);
  });

  it('odmítne příliš vysokou cenu paliva (> 500)', () => {
    expect(tripSchema.safeParse({ ...valid, price: 501 }).success).toBe(false);
  });

  it('odmítne chybějící pole', () => {
    const { cost, ...missing } = valid;
    expect(tripSchema.safeParse(missing).success).toBe(false);
  });
});
```

- [ ] **Step 2: Spusť testy — musí selhat**

```bash
npm test -- --testPathPattern=validation
```

Očekávaný výsledek: `Cannot find module '../lib/validation'`

- [ ] **Step 3: Implementuj lib/validation.js**

Vytvoř `lib/validation.js`:

```javascript
// Zod validační schémata pro vstupní data API endpointů
const { z } = require('zod');

// UUID v4 — třetí skupina začíná 4, čtvrtá začíná 8, 9, a nebo b
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const uuidSchema = z.string().regex(UUID_REGEX, 'Neplatné UUID v4');

// Rozsahy odpovídají reálným hodnotám — ochrana proti nevalidním vstupům
const tripSchema = z.object({
  userId: uuidSchema,
  date: z.string().datetime(),
  distance: z.number().positive().max(5000),
  consumption: z.number().positive().max(50),
  price: z.number().positive().max(500),
  liters: z.number().nonnegative().max(2500),
  cost: z.number().nonnegative().max(250000),
});

module.exports = { uuidSchema, tripSchema };
```

- [ ] **Step 4: Spusť testy — musí projít**

```bash
npm test -- --testPathPattern=validation
```

Očekávaný výsledek: `7 passed`

- [ ] **Step 5: Commit**

```bash
git add lib/validation.js __tests__/validation.test.js
git commit -m "feat: validační schémata pro API (Zod)"
```

---

## Task 3: Databázová vrstva (lib/db.js)

**Files:**
- Create: `lib/db.js`

*(db.js testujeme nepřímo přes API handlery v Task 4 a 5 — přímé testy by vyžadovaly živé Turso připojení)*

- [ ] **Step 1: Vytvoř lib/db.js**

```javascript
// Turso klient a inicializace databázového schématu
const { createClient } = require('@libsql/client');

let client = null;

// Singleton instance — znovu použita při warm start Vercel funkcí
function getDb() {
  if (!client) {
    client = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return client;
}

// Vytvoří tabulku a index pokud neexistují — bezpečné volat opakovaně
async function initDb() {
  const db = getDb();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS trips (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      date        TEXT NOT NULL,
      distance    REAL NOT NULL,
      consumption REAL NOT NULL,
      price       REAL NOT NULL,
      liters      REAL NOT NULL,
      cost        REAL NOT NULL
    )
  `);
  await db.execute(
    'CREATE INDEX IF NOT EXISTS idx_trips_user ON trips(user_id)'
  );
}

module.exports = { getDb, initDb };
```

- [ ] **Step 2: Commit**

```bash
git add lib/db.js
git commit -m "feat: Turso klient a inicializace schématu"
```

---

## Task 4: API handler GET + POST /api/trips

**Files:**
- Create: `api/trips.js`
- Create: `__tests__/trips-get-post.test.js`

- [ ] **Step 1: Napiš failing testy**

Vytvoř `__tests__/trips-get-post.test.js`:

```javascript
// Testy pro GET (seznam jízd) a POST (nová jízda) /api/trips
jest.mock('../lib/db', () => ({
  initDb: jest.fn().mockResolvedValue(undefined),
  getDb: jest.fn(),
}));

const { getDb } = require('../lib/db');
const handler = require('../api/trips');

// Helper — mockuje Express-style res objekt
function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

const VALID_USER = '550e8400-e29b-41d4-a716-446655440000';

const VALID_BODY = {
  userId: VALID_USER,
  date: '2026-04-12T10:00:00.000Z',
  distance: 150,
  consumption: 5.9,
  price: 38.5,
  liters: 8.85,
  cost: 340.73,
};

beforeEach(() => jest.clearAllMocks());

describe('GET /api/trips', () => {
  it('vrátí 400 pro neplatné userId', async () => {
    const req = { method: 'GET', query: { userId: 'not-a-uuid' } };
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Neplatné userId' });
  });

  it('vrátí 400 pro chybějící userId', async () => {
    const req = { method: 'GET', query: {} };
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('vrátí seznam jízd pro platné userId', async () => {
    const rows = [{ id: 'trip-1', user_id: VALID_USER, distance: 100 }];
    const mockExecute = jest.fn().mockResolvedValue({ rows });
    getDb.mockReturnValue({ execute: mockExecute });

    const req = { method: 'GET', query: { userId: VALID_USER } };
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(rows);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining('WHERE user_id = ?'),
        args: [VALID_USER],
      })
    );
  });
});

describe('POST /api/trips', () => {
  it('vrátí 400 pro neúplná data', async () => {
    const req = { method: 'POST', body: { userId: VALID_USER } };
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('vrátí 400 pro zápornou vzdálenost', async () => {
    const req = { method: 'POST', body: { ...VALID_BODY, distance: -10 } };
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('uloží jízdu a vrátí 201 s vygenerovaným ID', async () => {
    const mockExecute = jest.fn().mockResolvedValue({});
    getDb.mockReturnValue({ execute: mockExecute });

    const req = { method: 'POST', body: VALID_BODY };
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.any(String),
        distance: 150,
        cost: 340.73,
      })
    );
    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining('INSERT INTO trips'),
      })
    );
  });

  it('vrátí 405 pro nepodporovanou metodu', async () => {
    const req = { method: 'PUT', query: {}, body: {} };
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });
});
```

- [ ] **Step 2: Spusť testy — musí selhat**

```bash
npm test -- --testPathPattern=trips-get-post
```

Očekávaný výsledek: `Cannot find module '../api/trips'`

- [ ] **Step 3: Vytvoř složku api a implementuj api/trips.js**

```bash
mkdir api
```

Vytvoř `api/trips.js`:

```javascript
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
```

- [ ] **Step 4: Spusť testy — musí projít**

```bash
npm test -- --testPathPattern=trips-get-post
```

Očekávaný výsledek: `8 passed`

- [ ] **Step 5: Commit**

```bash
git add api/trips.js __tests__/trips-get-post.test.js
git commit -m "feat: GET + POST /api/trips s validací a Turso"
```

---

## Task 5: API handler DELETE /api/trips/[id]

**Files:**
- Create: `api/trips/[id].js`
- Create: `__tests__/trips-delete.test.js`

- [ ] **Step 1: Napiš failing testy**

Vytvoř `__tests__/trips-delete.test.js`:

```javascript
// Testy pro DELETE /api/trips/:id — ověřuje vlastnictví záznamu
jest.mock('../lib/db', () => ({
  initDb: jest.fn().mockResolvedValue(undefined),
  getDb: jest.fn(),
}));

const { getDb } = require('../lib/db');
const handler = require('../api/trips/[id]');

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

const VALID_ID   = '550e8400-e29b-41d4-a716-446655440000';
const VALID_USER = '660e8400-e29b-41d4-a716-446655440001';

beforeEach(() => jest.clearAllMocks());

describe('DELETE /api/trips/[id]', () => {
  it('vrátí 405 pro GET request', async () => {
    const req = { method: 'GET', query: { id: VALID_ID, userId: VALID_USER } };
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('vrátí 400 pro neplatné ID', async () => {
    const req = { method: 'DELETE', query: { id: 'bad-id', userId: VALID_USER } };
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('vrátí 400 pro neplatné userId', async () => {
    const req = { method: 'DELETE', query: { id: VALID_ID, userId: 'bad' } };
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('vrátí 404 když jízda nepatří uživateli', async () => {
    const mockExecute = jest.fn().mockResolvedValue({ rows: [] });
    getDb.mockReturnValue({ execute: mockExecute });

    const req = { method: 'DELETE', query: { id: VALID_ID, userId: VALID_USER } };
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockExecute).toHaveBeenCalledTimes(1); // jen SELECT, žádný DELETE
  });

  it('smaže jízdu a vrátí 200', async () => {
    const mockExecute = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: VALID_ID }] }) // SELECT ověření
      .mockResolvedValueOnce({});                           // DELETE

    getDb.mockReturnValue({ execute: mockExecute });

    const req = { method: 'DELETE', query: { id: VALID_ID, userId: VALID_USER } };
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Spusť testy — musí selhat**

```bash
npm test -- --testPathPattern=trips-delete
```

Očekávaný výsledek: `Cannot find module '../api/trips/[id]'`

- [ ] **Step 3: Vytvoř složku a implementuj api/trips/[id].js**

```bash
mkdir api/trips
```

Vytvoř `api/trips/[id].js`:

```javascript
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
```

- [ ] **Step 4: Spusť testy — musí projít**

```bash
npm test -- --testPathPattern=trips-delete
```

Očekávaný výsledek: `5 passed`

- [ ] **Step 5: Spusť všechny testy**

```bash
npm test
```

Očekávaný výsledek: `20 passed`

- [ ] **Step 6: Commit**

```bash
git add api/trips/[id].js __tests__/trips-delete.test.js
git commit -m "feat: DELETE /api/trips/:id s ověřením vlastnictví"
```

---

## Task 6: Úprava public/index.html

**Files:**
- Modify: `public/index.html`

Nahraď celý `<script>` blok (řádky 543–798) níže uvedeným kódem. HTML a CSS zůstávají beze změny.

- [ ] **Step 1: Nahraď script blok v public/index.html**

```html
<script>
  // ── Anonymní identifikace uživatele ──
  // UUID v4 uložené v localStorage — každé zařízení/prohlížeč má unikátní ID
  const USER_ID_KEY = 'fuel_user_id';

  function getUserId() {
    let id = localStorage.getItem(USER_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(USER_ID_KEY, id);
    }
    return id;
  }

  let history = [];

  // ── API helpers ──
  async function fetchTrips() {
    const userId = getUserId();
    const res = await fetch(`/api/trips?userId=${userId}`);
    if (!res.ok) throw new Error('Nepodařilo se načíst jízdy');
    const data = await res.json();
    // Odstraní user_id z odpovědi — frontend ho nepotřebuje
    history = data.map(({ user_id, ...rest }) => rest);
  }

  async function postTrip(trip) {
    const res = await fetch('/api/trips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...trip, userId: getUserId() }),
    });
    if (!res.ok) throw new Error('Nepodařilo se uložit jízdu');
    return res.json();
  }

  async function deleteTrip(id) {
    const userId = getUserId();
    const res = await fetch(`/api/trips/${id}?userId=${userId}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Nepodařilo se smazat jízdu');
  }

  // ── Price suggestion ──
  function getLastPrice() {
    if (!history.length) return null;
    return [...history].sort((a, b) => new Date(b.date) - new Date(a.date))[0].price;
  }

  function renderSuggestion() {
    const lastPrice = getLastPrice();
    const el = document.getElementById('priceSuggestion');
    const priceInput = document.getElementById('price');

    if (lastPrice !== null && priceInput.value === '') {
      el.style.display = 'block';
      el.innerHTML = `<span class="suggestion" id="suggChip">⚡ Minule: <strong>${lastPrice.toFixed(2)} Kč</strong> — použít?</span>`;
      document.getElementById('suggChip').onclick = () => {
        priceInput.value = lastPrice.toFixed(2);
        el.style.display = 'none';
        calculate();
      };
    } else {
      el.style.display = 'none';
    }
  }

  // ── Calculate ──
  function calculate() {
    const dist  = parseFloat(document.getElementById('distance').value) || 0;
    const cons  = parseFloat(document.getElementById('consumption').value) || 0;
    const price = parseFloat(document.getElementById('price').value) || 0;

    if (dist <= 0 || cons <= 0 || price <= 0) {
      document.getElementById('resultLiters').textContent = '—';
      document.getElementById('resultCost').textContent   = '—';
      document.getElementById('resultPerKm').textContent  = '—';
      return null;
    }

    const liters = (dist * cons) / 100;
    const cost   = liters * price;
    const perKm  = cost / dist;

    document.getElementById('resultLiters').textContent = liters.toFixed(3);
    document.getElementById('resultCost').textContent   = cost.toFixed(2);
    document.getElementById('resultPerKm').textContent  = perKm.toFixed(2);

    return { liters, cost, perKm };
  }

  // ── Loading state ──
  function setSaveLoading(isLoading) {
    const btn = document.getElementById('btnSave');
    btn.disabled    = isLoading;
    btn.textContent = isLoading ? '⏳ Ukládám...' : '💾 Uložit jízdu';
  }

  // ── Save trip ──
  async function saveTrip() {
    const dist  = parseFloat(document.getElementById('distance').value);
    const cons  = parseFloat(document.getElementById('consumption').value);
    const price = parseFloat(document.getElementById('price').value);

    if (!dist || !cons || !price) {
      showToast('⚠️ Vyplň všechna pole!', '#f59e0b', '#451a03');
      return;
    }

    const result = calculate();
    if (!result) return;

    setSaveLoading(true);
    try {
      const saved = await postTrip({
        date:        new Date().toISOString(),
        distance:    dist,
        consumption: cons,
        price:       price,
        liters:      result.liters,
        cost:        result.cost,
      });

      // Odstraní userId z lokálního záznamu
      const { userId, ...trip } = saved;
      history.push(trip);

      document.getElementById('distance').value          = '';
      document.getElementById('resultLiters').textContent = '—';
      document.getElementById('resultCost').textContent   = '—';
      document.getElementById('resultPerKm').textContent  = '—';

      renderSuggestion();
      renderHistory();
      renderStats();
      showToast('✅ Jízda uložena!');
    } catch {
      showToast('⚠️ Chyba při ukládání!', '#f59e0b', '#451a03');
    } finally {
      setSaveLoading(false);
    }
  }

  // ── Toast ──
  function showToast(msg, bg = '#22c55e', color = '#052e16') {
    const t = document.getElementById('toast');
    t.textContent      = msg;
    t.style.background = bg;
    t.style.color      = color;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2200);
  }

  // ── Month selector ──
  function buildMonthSelector() {
    const months = {};
    history.forEach(t => {
      const d   = new Date(t.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      months[key] = (months[key] || 0) + 1;
    });

    const keys = Object.keys(months).sort().reverse();
    const sel  = document.getElementById('monthSelect');
    const current = sel.value;
    sel.innerHTML = `<option value="all">Všechny měsíce (${history.length})</option>`;

    keys.forEach(k => {
      const [y, m] = k.split('-');
      const label  = new Date(y, m - 1).toLocaleDateString('cs-CZ', { month: 'long', year: 'numeric' });
      const opt    = document.createElement('option');
      opt.value    = k;
      opt.textContent = `${label} (${months[k]})`;
      sel.appendChild(opt);
    });

    if (current && [...sel.options].some(o => o.value === current)) {
      sel.value = current;
    } else if (keys.length) {
      sel.value = keys[0];
    }
  }

  function getFilteredHistory() {
    const sel = document.getElementById('monthSelect').value;
    if (sel === 'all') return history;
    return history.filter(t => {
      const d   = new Date(t.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      return key === sel;
    });
  }

  // ── Render stats ──
  function renderStats() {
    const filtered  = getFilteredHistory();
    const totalKm   = filtered.reduce((s, t) => s + t.distance, 0);
    const totalL    = filtered.reduce((s, t) => s + t.liters, 0);
    const totalCost = filtered.reduce((s, t) => s + t.cost, 0);
    const trips     = filtered.length;

    document.getElementById('statKm').textContent      = totalKm.toFixed(1);
    document.getElementById('statLiters').textContent  = totalL.toFixed(2);
    document.getElementById('statCost').textContent    = Math.round(totalCost);
    document.getElementById('statTrips').textContent   = trips;
    document.getElementById('statAvgKm').textContent   = trips ? (totalKm / trips).toFixed(1) : '0';
    document.getElementById('statAvgCost').textContent = trips ? Math.round(totalCost / trips) : '0';
  }

  // ── Render history ──
  function renderHistory() {
    buildMonthSelector();
    const filtered = getFilteredHistory().slice().reverse();
    const el       = document.getElementById('historyList');

    if (!filtered.length) {
      el.innerHTML = `<div class="empty-state"><div class="big">🚗</div>Žádné jízdy v tomto období</div>`;
      return;
    }

    el.innerHTML = filtered.map(trip => {
      const d          = new Date(trip.date);
      const day        = d.getDate();
      const monthShort = d.toLocaleDateString('cs-CZ', { month: 'short' });
      const time       = d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });

      return `
        <div class="history-item">
          <div class="hi-date">
            <div class="day">${day}.</div>
            <div>${monthShort}</div>
            <div>${time}</div>
          </div>
          <div class="hi-body">
            <div class="hi-km">${trip.distance.toFixed(1)} km</div>
            <div class="hi-meta">${trip.consumption} l/100 &nbsp;·&nbsp; ${trip.price.toFixed(2)} Kč/l</div>
          </div>
          <div class="hi-cost">
            <div class="amount">${trip.cost.toFixed(2)} Kč</div>
            <div class="liters">${trip.liters.toFixed(3)} l</div>
          </div>
          <button class="hi-delete" onclick="handleDeleteTrip('${trip.id}')" title="Smazat">✕</button>
        </div>
      `;
    }).join('');
  }

  // ── Delete trip ──
  async function handleDeleteTrip(id) {
    try {
      await deleteTrip(id);
      history = history.filter(t => t.id !== id);
      renderHistory();
      renderStats();
      renderSuggestion();
      showToast('🗑️ Jízda smazána', '#ef4444', '#450a0a');
    } catch {
      showToast('⚠️ Chyba při mazání!', '#f59e0b', '#451a03');
    }
  }

  // ── Clear all ──
  document.getElementById('btnClearAll').onclick = async () => {
    if (!history.length) return;
    if (confirm('Opravdu smazat celou historii?')) {
      try {
        await Promise.all(history.map(t => deleteTrip(t.id)));
        history = [];
        renderHistory();
        renderStats();
        renderSuggestion();
        showToast('🗑️ Historie smazána', '#ef4444', '#450a0a');
      } catch {
        showToast('⚠️ Chyba při mazání!', '#f59e0b', '#451a03');
      }
    }
  };

  // ── Event listeners ──
  document.getElementById('btnCalc').onclick  = calculate;
  document.getElementById('btnSave').onclick  = saveTrip;

  ['distance', 'consumption', 'price'].forEach(id => {
    document.getElementById(id).addEventListener('input', calculate);
  });

  document.getElementById('price').addEventListener('focus', renderSuggestion);

  document.getElementById('monthSelect').addEventListener('change', () => {
    renderHistory();
    renderStats();
  });

  document.getElementById('btnResetFilter').addEventListener('click', () => {
    document.getElementById('monthSelect').value = 'all';
    renderHistory();
    renderStats();
  });

  // ── Init ──
  async function init() {
    try {
      await fetchTrips();
    } catch {
      showToast('⚠️ Nepodařilo se načíst jízdy', '#f59e0b', '#451a03');
    }
    renderSuggestion();
    renderHistory();
    renderStats();
  }

  init();
</script>
```

- [ ] **Step 2: Commit**

```bash
git add public/index.html
git commit -m "feat: frontend přepnut na API místo localStorage"
```

---

## Task 7: README + GitHub příprava

**Files:**
- Create: `README.md`

- [ ] **Step 1: Vytvoř README.md**

```markdown
# Fuel Tool — Kalkulátor spotřeby paliva

Sleduj náklady a kilometry každé jízdy. Webová aplikace s persistentní databází, anonymní identifikací uživatelů a Vercel deployem.

## Stack

- Frontend: vanilla HTML/CSS/JS
- Backend: Vercel Serverless Functions (Node.js)
- Databáze: [Turso](https://turso.tech) (libSQL / SQLite)

## Jak to funguje

Při první návštěvě se vygeneruje anonymní UUID a uloží do localStorage. Každý request posílá toto UUID — data jsou oddělená per-zařízení bez nutnosti přihlašování.

## Lokální vývoj

### 1. Závislosti

```bash
npm install
npm install -g vercel
```

### 2. Vytvoř Turso databázi

```bash
# Instalace Turso CLI
curl -sSfL https://get.tur.so/install.sh | bash

# Přihlášení a vytvoření DB
turso auth signup
turso db create fuel-tool
turso db show fuel-tool       # zkopíruj URL
turso db tokens create fuel-tool  # zkopíruj token
```

### 3. Nastav env proměnné

Zkopíruj `.env.example` → `.env.local` a doplň hodnoty:

```
TURSO_DATABASE_URL=libsql://fuel-tool-<username>.turso.io
TURSO_AUTH_TOKEN=<token>
```

### 4. Spusť lokálně

```bash
vercel link   # propoj s Vercel projektem (jen poprvé)
npm run dev   # http://localhost:3000
```

## Vercel deploy

1. Pushni na GitHub
2. Importuj repozitář na [vercel.com](https://vercel.com)
3. Přidej env proměnné v nastavení projektu:
   - `TURSO_DATABASE_URL`
   - `TURSO_AUTH_TOKEN`
4. Deploy

## Testy

```bash
npm test
```

## Environment variables

| Proměnná | Popis |
|---|---|
| `TURSO_DATABASE_URL` | URL Turso databáze (formát: `libsql://...`) |
| `TURSO_AUTH_TOKEN` | Auth token pro přístup k databázi |
```

- [ ] **Step 2: Finální commit**

```bash
git add README.md
git commit -m "docs: README se setup instrukcemi pro Turso + Vercel"
```

- [ ] **Step 3: Ověř že .env soubory nejsou v gitu**

```bash
git status
```

Výstup NESMÍ obsahovat `.env.local` ani žádný soubor s tokeny.

- [ ] **Step 4: Finální test suite**

```bash
npm test
```

Očekávaný výsledek: `20 passed, 0 failed`

---

## Vercel setup (po deployi)

Po pushnutí na GitHub a importu do Vercel:

1. V Vercel dashboardu → projekt → **Settings → Environment Variables**
2. Přidej `TURSO_DATABASE_URL` a `TURSO_AUTH_TOKEN` pro `Production` + `Preview`
3. Redeploy

Schéma databáze se vytvoří automaticky při prvním requestu (`initDb()` v každém handleru).
