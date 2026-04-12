# Fuel Tool — Kalkulátor spotřeby paliva

Fuel Cost Calculator is a lightweight web app for tracking trip fuel usage, costs, and monthly driving statistics.

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
turso db show fuel-tool           # zkopíruj URL
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
