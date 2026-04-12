# Fuel Tool — Fuel Cost Calculator

A lightweight web app for tracking trip fuel costs, consumption, and monthly driving statistics. Each user is identified by an anonymous UUID stored in localStorage — no login required.

## Stack

- Frontend: vanilla HTML/CSS/JS
- Backend: Vercel Serverless Functions (Node.js)
- Database: [Turso](https://turso.tech) (libSQL / SQLite-compatible)

## How it works

On first visit a UUID v4 is generated and stored in localStorage as `fuel_user_id`. Every API request includes this ID — data is isolated per device without any authentication.

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

Create a `.env.local` file in the project root:

```
TURSO_DATABASE_URL=libsql://fuel-tool-<your-username>.aws-eu-west-1.turso.io
TURSO_AUTH_TOKEN=<your-auth-token>
```

### 4. Run locally

```bash
vercel link    # link to your Vercel project (first time only)
npm run dev    # http://localhost:3000
```

## Tests

```bash
npm test
```
