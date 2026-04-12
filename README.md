# Fuel Tool — Fuel Cost Calculator

A lightweight web app for tracking trip fuel costs, consumption, and monthly driving statistics.

The repository is safe to keep public because sensitive values are loaded only from environment variables. API code can be public, secrets cannot.

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
npm install -g vercel
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
vercel link    # link to your Vercel project (first time only)
npm run dev    # http://localhost:3000
```

## Tests

```bash
npm test
```

## Security checklist

- Keep only placeholders in `.env.example`
- Rotate `SESSION_SECRET` if exposed
- Do not expose Turso token in client code or committed files
- Review API responses for accidental sensitive data
