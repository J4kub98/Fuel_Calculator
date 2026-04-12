# Fuel Tool — Fuel Cost Calculator

A lightweight web app for tracking trip fuel costs, consumption, and monthly driving statistics.

The repository is safe to keep public because sensitive values are loaded only from environment variables. API code can be public, secrets cannot.

Serverless handlers are stored in `backend/` and routed to `/api/*` via `vercel.json`.

## Stack

- Frontend: vanilla HTML/CSS/JS
- Backend: Vercel Serverless Functions (Node.js)
- Database: [Turso](https://turso.tech) (libSQL / SQLite-compatible)

## How it works

On first visit frontend calls `POST /api/session`.

- Server creates or migrates a UUID identity and stores it in signed, HttpOnly cookie (`fuel_sid`)
- API endpoints read user identity only from this cookie
- Frontend no longer sends `userId` in query/body

This prevents users from changing identity via devtools and accessing other users' data.

## Local development

### 1. Install dependencies

```bash
npm install
```

### 2. Create a Turso database

```bash
# Install Turso CLI (Mac/Linux)
curl -sSfL https://get.tur.so/install.sh | bash

# Sign up and create the database
turso auth signup
turso db create fuel-tool
turso db show fuel-tool            # copy the URL
turso db tokens create fuel-tool   # copy the auth token
```

### 3. Set environment variables

Create a `.env.local` file in the project root from `.env.example`:

```
TURSO_DATABASE_URL=libsql://fuel-tool-<your-username>.aws-eu-west-1.turso.io
TURSO_AUTH_TOKEN=<your-auth-token>
SESSION_SECRET=<long-random-secret-at-least-32-chars>
RATE_LIMIT_MAX=120
RATE_LIMIT_WINDOW_MS=60000
```

Never commit `.env` / `.env.local` files.

### 4. Run locally

```bash
npm run dev    # http://localhost:3000
```

### 5. Optional: run with Vercel runtime

```bash
npm run dev:vercel
```

## Vercel Config (optional)

If you run the app only with the local Node server (`npm run dev`),
`vercel.json` is optional and can be removed.

Keep `vercel.json` if you want to deploy or run the app with Vercel,
because it contains Vercel-specific routing and security headers.

## Tests

```bash
npm test
```

## Security checklist

- Keep only placeholders in `.env.example`
- Rotate `SESSION_SECRET` if exposed
- Do not expose Turso token in client code or committed files
- Review API responses for accidental sensitive data
