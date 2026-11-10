const { randomUUID, createHmac, timingSafeEqual } = require('crypto');
const { uuidSchema } = require('./validation');

const SESSION_COOKIE_NAME = 'fuel_sid';
// 400 dní je maximum, které prohlížeče u cookie povolí. Cookie se navíc při
// každém otevření aplikace obnovuje, takže při běžném používání nevyprší.
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 400;

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('Missing or weak SESSION_SECRET environment variable');
  }
  return secret;
}

function toBase64Url(input) {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function fromBase64Url(input) {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function sign(payloadEncoded) {
  return createHmac('sha256', getSessionSecret())
    .update(payloadEncoded)
    .digest('base64url');
}

// Obecná podepsaná hodnota s expirací (session cookie, WebAuthn výzva)
function createSignedValue(data, ttlSeconds) {
  const payload = JSON.stringify({
    ...data,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  });

  const payloadEncoded = toBase64Url(payload);
  const signature = sign(payloadEncoded);
  return `${payloadEncoded}.${signature}`;
}

function verifySignedValue(value) {
  if (!value || typeof value !== 'string') return null;
  const [payloadEncoded, signature] = value.split('.');
  if (!payloadEncoded || !signature) return null;

  const expected = sign(payloadEncoded);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return null;
  }

  try {
    const payload = JSON.parse(fromBase64Url(payloadEncoded));
    const now = Math.floor(Date.now() / 1000);
    if (!payload || typeof payload.exp !== 'number' || payload.exp <= now) return null;
    return payload;
  } catch {
    return null;
  }
}

function createSignedSessionValue(userId) {
  return createSignedValue({ uid: userId }, SESSION_TTL_SECONDS);
}

function parseCookies(cookieHeader = '') {
  const out = {};
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

function verifySignedSessionValue(value) {
  const payload = verifySignedValue(value);
  if (!payload) return null;
  const parsed = uuidSchema.safeParse(payload.uid);
  if (!parsed.success) return null;
  return { userId: parsed.data };
}

function getSession(req) {
  const cookieHeader = req?.headers?.cookie || '';
  const cookies = parseCookies(cookieHeader);
  return verifySignedSessionValue(cookies[SESSION_COOKIE_NAME]);
}

function isSecureCookieEnv() {
  return process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
}

function createSessionCookie(userId) {
  const signedValue = createSignedSessionValue(userId);
  const secure = isSecureCookieEnv();

  return [
    `${SESSION_COOKIE_NAME}=${signedValue}`,
    'Path=/',
    `Max-Age=${SESSION_TTL_SECONDS}`,
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : null,
  ]
    .filter(Boolean)
    .join('; ');
}

function resolveOrCreateUserId(legacyUserId) {
  const parsedLegacy = uuidSchema.safeParse(legacyUserId);
  if (parsedLegacy.success) return parsedLegacy.data;
  return randomUUID();
}

module.exports = {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  createSessionCookie,
  createSignedValue,
  verifySignedValue,
  parseCookies,
  isSecureCookieEnv,
  getSession,
  resolveOrCreateUserId,
};
