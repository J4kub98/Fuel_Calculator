# Fuel Tool — Backend + Turso DB Design

**Datum:** 2026-04-12  
**Projekt:** Kalkulátor spotřeby paliva  
**Cíl:** Přidat persistentní databázi (Turso/libSQL), anonymní multi-user identifikaci a připravit projekt na GitHub + Vercel deploy.

---

## 1. Architektura

**Stack:**
- Frontend: stávající HTML/CSS/JS (minimální změny)
- Backend: Vercel Serverless Functions (Node.js)
- Databáze: Turso (libSQL — SQLite-kompatibilní, serverless)
- Identifikace uživatelů: anonymní UUID v4 v localStorage

**Struktura projektu:**
```
fuel-tool/
├── public/
│   └── index.html          ← stávající UI, localStorage → fetch()
├── api/
│   ├── trips.js            ← GET + POST
│   └── trips/
│       └── [id].js         ← DELETE
├── lib/
│   └── db.js               ← Turso klient, init schema
├── package.json
├── .gitignore
└── .env.local              ← lokální proměnné (není v gitu)
```

---

## 2. Anonymní identifikace uživatelů

- Při první návštěvě se vygeneruje `UUID v4` (crypto.randomUUID()) a uloží do `localStorage` jako `fuel_user_id`
- Každý API request posílá toto UUID
- Server ukládá data vázaná na toto UUID
- Různá zařízení = různé UUID = oddělená data
- ⚠️ Smazání localStorage = ztráta přístupu k datům (data v DB zůstanou, ale uživatel se k nim nedostane bez UUID)

---

## 3. Databázové schema

```sql
CREATE TABLE IF NOT EXISTS trips (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  date        TEXT NOT NULL,
  distance    REAL NOT NULL,
  consumption REAL NOT NULL,
  price       REAL NOT NULL,
  liters      REAL NOT NULL,
  cost        REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trips_user ON trips(user_id);
```

Schema se inicializuje automaticky při prvním requestu (funkce `initDb()` v `lib/db.js`).

---

## 4. API endpointy

### GET /api/trips?userId=<uuid>
- Vrátí všechny jízdy daného uživatele seřazené od nejnovější
- Validuje UUID formát
- Vrátí `[]` pokud uživatel nemá žádné záznamy

### POST /api/trips
```json
{
  "userId": "uuid-v4",
  "date": "ISO 8601 string",
  "distance": 150.5,
  "consumption": 5.9,
  "price": 38.50,
  "liters": 8.88,
  "cost": 341.88
}
```
- Validuje všechna pole (Zod)
- Generuje nové UUID pro `id` záznamu
- Vrátí vytvořený záznam

### DELETE /api/trips/[id]?userId=<uuid>
- Smaže jízdu pouze pokud `user_id` odpovídá — ochrana cross-user mazání
- Validuje UUID formát
- Vrátí 404 pokud záznam neexistuje nebo nepatří uživateli

---

## 5. Bezpečnost

| Ochrana | Implementace |
|---|---|
| Izolace dat | `user_id` check na všech read/delete operacích |
| SQL injection | Parametrizované dotazy přes `@libsql/client` |
| Validace vstupu | Zod schema na každém POST endpointu |
| UUID validace | Regex check na UUID v4 formát |
| Rozumné limity | distance: 1–5000 km, consumption: 1–50 l/100, price: 1–500 Kč/l |
| Secrets | TURSO_DATABASE_URL a TURSO_AUTH_TOKEN pouze v .env, nikdy v gitu |
| HTTPS | Vercel zajišťuje automaticky |
| Rate limiting | 60 req/min na IP přes Vercel middleware (X-Forwarded-For header) |

---

## 6. Změny v index.html

- Přidat `initUserId()` — generuje/načítá UUID z localStorage
- Nahradit `loadHistory()` / `saveHistory()` za async `fetchTrips()` / `postTrip()` / `deleteTrip()`
- Přidat loading stavy (tlačítka disabled během API callů)
- Přidat error handling pro offline / API chyby

---

## 7. GitHub readiness

- `.gitignore`: `node_modules/`, `.env*`, `.env.local`
- `README.md`: popis projektu, setup instrukce, Vercel deploy postup
- `package.json`: závislosti (`@libsql/client`, `zod`, `uuid`)
- Environment variables dokumentovány v `README.md` (ne jejich hodnoty)

---

## 8. Lokální vývoj

```bash
npm install
# Vytvořit .env.local s:
# TURSO_DATABASE_URL=libsql://...
# TURSO_AUTH_TOKEN=...
npx vercel dev
```

---

## 9. Co se NEimplementuje

- Přihlašování / uživatelské účty
- Export dat
- Sdílení jízd mezi uživateli
- Editace existující jízdy
- Pushové notifikace / emaily
