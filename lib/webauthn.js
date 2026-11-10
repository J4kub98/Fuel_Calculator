// Pomocné funkce pro přístupové klíče (WebAuthn / passkeys).
const {
  createSignedValue,
  verifySignedValue,
  parseCookies,
  isSecureCookieEnv,
} = require('./session');

const CHALLENGE_COOKIE_NAME = 'fuel_wa';
const CHALLENGE_TTL_SECONDS = 5 * 60;
const RP_NAME = 'Fuel Calculator';

function firstHeader(value) {
  if (Array.isArray(value)) return value[0];
  return typeof value === 'string' ? value.split(',')[0].trim() : '';
}

function isLocalHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/**
 * Určí relying party (doménu, ke které se přístupový klíč váže) z požadavku.
 * Přístupový klíč je vázaný na doménu — klíč vytvořený na jedné doméně
 * na jiné nefunguje. Volitelně lze povolené originy omezit proměnnou
 * WEBAUTHN_ORIGINS (čárkou oddělený seznam, např. https://app.example.com).
 * Vrací { rpID, origin } nebo null, pokud doména není povolená.
 */
function getRelyingParty(req) {
  const headers = req.headers || {};
  const host = firstHeader(headers['x-forwarded-host']) || firstHeader(headers.host);
  if (!host) return null;

  let url;
  try {
    const proto = firstHeader(headers['x-forwarded-proto']) || (isLocalHost(host.split(':')[0]) ? 'http' : 'https');
    url = new URL(`${proto}://${host}`);
  } catch {
    return null;
  }

  // WebAuthn funguje jen v zabezpečeném kontextu (HTTPS nebo localhost)
  if (url.protocol !== 'https:' && !isLocalHost(url.hostname)) return null;

  const allowed = (process.env.WEBAUTHN_ORIGINS || '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
  if (allowed.length && !allowed.includes(url.origin)) return null;

  return { rpID: url.hostname, origin: url.origin };
}

function createChallengeCookie(data) {
  const value = createSignedValue(data, CHALLENGE_TTL_SECONDS);
  return [
    `${CHALLENGE_COOKIE_NAME}=${value}`,
    'Path=/api/passkey',
    `Max-Age=${CHALLENGE_TTL_SECONDS}`,
    'HttpOnly',
    'SameSite=Strict',
    isSecureCookieEnv() ? 'Secure' : null,
  ].filter(Boolean).join('; ');
}

function clearChallengeCookie() {
  return [
    `${CHALLENGE_COOKIE_NAME}=`,
    'Path=/api/passkey',
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Strict',
    isSecureCookieEnv() ? 'Secure' : null,
  ].filter(Boolean).join('; ');
}

function readChallenge(req, flow) {
  const cookies = parseCookies((req.headers && req.headers.cookie) || '');
  const payload = verifySignedValue(cookies[CHALLENGE_COOKIE_NAME]);
  if (!payload || payload.f !== flow || typeof payload.c !== 'string') return null;
  return payload;
}

module.exports = {
  RP_NAME,
  CHALLENGE_COOKIE_NAME,
  getRelyingParty,
  createChallengeCookie,
  clearChallengeCookie,
  readChallenge,
};
