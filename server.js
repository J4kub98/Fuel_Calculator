const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const querystring = require('querystring');

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const MAX_BODY_SIZE = 1024 * 1024;

loadEnvFiles();

const handlers = {
  session: require('./backend/session'),
  trips: require('./backend/trips'),
  tripById: require('./backend/trips/[id]'),
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
};

function loadEnvFiles() {
  loadEnvFile(path.join(ROOT_DIR, '.env'), false);
  loadEnvFile(path.join(ROOT_DIR, '.env.local'), true);
}

function loadEnvFile(filePath, override) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const key = match[1];
    let value = match[2] || '';

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (override || process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function addResponseHelpers(res) {
  res.status = function status(code) {
    res.statusCode = code;
    return res;
  };

  res.json = function json(payload) {
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    res.end(JSON.stringify(payload));
  };
}

function parseQuery(searchParams) {
  const query = {};
  for (const [key, value] of searchParams.entries()) {
    if (Object.prototype.hasOwnProperty.call(query, key)) {
      if (Array.isArray(query[key])) {
        query[key].push(value);
      } else {
        query[key] = [query[key], value];
      }
    } else {
      query[key] = value;
    }
  }
  return query;
}

async function parseBody(req) {
  const method = (req.method || '').toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    return undefined;
  }

  const chunks = [];
  let total = 0;

  await new Promise((resolve, reject) => {
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_SIZE) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', resolve);
    req.on('error', reject);
  });

  if (chunks.length === 0) return {};

  const rawBody = Buffer.concat(chunks).toString('utf8');
  const contentType = (req.headers['content-type'] || '').toLowerCase();

  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(rawBody);
    } catch {
      return rawBody;
    }
  }

  if (contentType.includes('application/x-www-form-urlencoded')) {
    return querystring.parse(rawBody);
  }

  return rawBody;
}

function sendNotFound(res) {
  res.status(404).json({ error: 'Not found' });
}

function sendMethodNotAllowed(res) {
  res.status(405).json({ error: 'Method not allowed' });
}

async function handleApi(req, res, pathname, query) {
  const method = (req.method || '').toUpperCase();

  if (pathname === '/api/session') {
    if (method !== 'POST') return sendMethodNotAllowed(res);
    req.query = query;
    req.body = await parseBody(req);
    return handlers.session(req, res);
  }

  if (pathname === '/api/trips') {
    if (method !== 'GET' && method !== 'POST') return sendMethodNotAllowed(res);
    req.query = query;
    req.body = await parseBody(req);
    return handlers.trips(req, res);
  }

  const match = pathname.match(/^\/api\/trips\/([^/]+)$/);
  if (match) {
    if (method !== 'DELETE') return sendMethodNotAllowed(res);
    req.query = { ...query, id: decodeURIComponent(match[1]) };
    req.body = await parseBody(req);
    return handlers.tripById(req, res);
  }

  return sendNotFound(res);
}

async function serveStatic(req, res, pathname) {
  const normalized = pathname === '/' ? '/index.html' : pathname;
  const relativePath = decodeURIComponent(normalized).replace(/^\/+/, '');
  const filePath = path.resolve(PUBLIC_DIR, relativePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendNotFound(res);
  }

  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    return sendNotFound(res);
  }

  if (!stat.isFile()) {
    return sendNotFound(res);
  }

  const ext = path.extname(filePath).toLowerCase();
  res.statusCode = 200;
  res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');

  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    } else {
      res.end();
    }
  });
  stream.pipe(res);
}

const server = http.createServer(async (req, res) => {
  addResponseHelpers(res);

  try {
    const requestUrl = new URL(req.url || '/', 'http://localhost');
    const pathname = requestUrl.pathname;
    const query = parseQuery(requestUrl.searchParams);

    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname, query);
      return;
    }

    await serveStatic(req, res, pathname);
  } catch (err) {
    console.error('[server]', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    } else {
      res.end();
    }
  }
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
