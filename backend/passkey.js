// Přístupové klíče (passkeys) — záloha a obnova identity přes Face ID / otisk.
//
//   GET  /api/passkey                   → počet přístupových klíčů aktuálního uživatele
//   POST /api/passkey/register/options  → výzva pro vytvoření klíče (vyžaduje session)
//   POST /api/passkey/register/verify   → ověří a uloží nový klíč
//   POST /api/passkey/login/options     → výzva pro přihlášení (bez session)
//   POST /api/passkey/login/verify      → ověří klíč a přepne session na jeho vlastníka
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const { isoBase64URL, isoUint8Array } = require('@simplewebauthn/server/helpers');
const { initDb, getDb } = require('../lib/db');
const { getSession, createSessionCookie } = require('../lib/session');
const { setSecurityHeaders } = require('../lib/http');
const { checkRateLimit } = require('../lib/rateLimit');
const {
  RP_NAME,
  getRelyingParty,
  createChallengeCookie,
  clearChallengeCookie,
  readChallenge,
} = require('../lib/webauthn');

const MAX_PASSKEYS_PER_USER = 10;

function readBody(req) {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body || '{}');
    } catch {
      return null;
    }
  }
  return req.body || {};
}

function parseTransports(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function listUserPasskeys(db, userId) {
  const result = await db.execute({
    sql: 'SELECT id, transports FROM passkeys WHERE user_id = ?',
    args: [userId],
  });
  return result.rows;
}

module.exports = async function handler(req, res) {
  setSecurityHeaders(res);

  const rate = checkRateLimit(req, `/api/passkey:${req.method || 'UNKNOWN'}`);
  res.setHeader('X-RateLimit-Remaining', String(rate.remaining));
  if (!rate.ok) {
    res.setHeader('Retry-After', String(rate.retryAfter));
    return res.status(429).json({ error: 'Too many requests' });
  }

  try {
    await initDb();
    const flow = req.query && req.query.flow;
    const step = req.query && req.query.step;

    if (!flow && !step) {
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      return handleStatus(req, res);
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const rp = getRelyingParty(req);
    if (!rp) {
      return res.status(400).json({ error: 'Přístupové klíče na této adrese nejsou dostupné' });
    }

    const action = `${flow}/${step}`;
    if (action === 'register/options') return registerOptions(req, res, rp);
    if (action === 'register/verify') return registerVerify(req, res, rp);
    if (action === 'login/options') return loginOptions(req, res, rp);
    if (action === 'login/verify') return loginVerify(req, res, rp);
    return res.status(404).json({ error: 'Not found' });
  } catch (err) {
    console.error('[/api/passkey]', err);
    return res.status(500).json({ error: 'Interní chyba serveru' });
  }
};

async function handleStatus(req, res) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Neautorizováno' });

  const passkeys = await listUserPasskeys(getDb(), session.userId);
  return res.status(200).json({ count: passkeys.length });
}

async function registerOptions(req, res, rp) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Neautorizováno' });

  const existing = await listUserPasskeys(getDb(), session.userId);
  if (existing.length >= MAX_PASSKEYS_PER_USER) {
    return res.status(400).json({ error: 'Dosáhl jsi maximálního počtu přístupových klíčů' });
  }

  // Ve správci hesel se klíč zobrazí pod celým ID zařízení, takže ho odtud
  // jde zkopírovat a použít i pro ruční import.
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp.rpID,
    userName: session.userId,
    userDisplayName: RP_NAME,
    userID: isoUint8Array.fromUTF8String(session.userId),
    attestationType: 'none',
    excludeCredentials: existing.map((row) => ({
      id: row.id,
      transports: parseTransports(row.transports),
    })),
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'preferred',
    },
  });

  res.setHeader('Set-Cookie', createChallengeCookie({
    f: 'reg',
    c: options.challenge,
    u: session.userId,
  }));
  return res.status(200).json(options);
}

async function registerVerify(req, res, rp) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Neautorizováno' });

  const challenge = readChallenge(req, 'reg');
  if (!challenge || challenge.u !== session.userId) {
    return res.status(400).json({ error: 'Platnost požadavku vypršela, zkus to znovu' });
  }

  const body = readBody(req);
  if (!body || typeof body.id !== 'string') {
    return res.status(400).json({ error: 'Neplatná odpověď přístupového klíče' });
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge: challenge.c,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: false,
    });
  } catch (err) {
    console.warn('[/api/passkey] registration rejected:', err.message);
    verification = { verified: false };
  }

  res.setHeader('Set-Cookie', clearChallengeCookie());
  if (!verification.verified) {
    return res.status(400).json({ error: 'Přístupový klíč se nepodařilo ověřit' });
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  const db = getDb();
  await db.execute({
    sql: `INSERT OR IGNORE INTO passkeys (id, user_id, public_key, counter, transports, device_type, backed_up)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      credential.id,
      session.userId,
      isoBase64URL.fromBuffer(credential.publicKey),
      credential.counter || 0,
      JSON.stringify(credential.transports || []),
      credentialDeviceType || null,
      credentialBackedUp ? 1 : 0,
    ],
  });

  const passkeys = await listUserPasskeys(db, session.userId);
  return res.status(200).json({ verified: true, count: passkeys.length, backedUp: Boolean(credentialBackedUp) });
}

async function loginOptions(req, res, rp) {
  // Bez allowCredentials — prohlížeč nabídne klíče uložené pro tuto doménu
  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    userVerification: 'preferred',
  });

  res.setHeader('Set-Cookie', createChallengeCookie({ f: 'auth', c: options.challenge }));
  return res.status(200).json(options);
}

async function loginVerify(req, res, rp) {
  const challenge = readChallenge(req, 'auth');
  if (!challenge) {
    return res.status(400).json({ error: 'Platnost požadavku vypršela, zkus to znovu' });
  }

  const body = readBody(req);
  if (!body || typeof body.id !== 'string') {
    return res.status(400).json({ error: 'Neplatná odpověď přístupového klíče' });
  }

  const db = getDb();
  const found = await db.execute({
    sql: 'SELECT id, user_id, public_key, counter, transports FROM passkeys WHERE id = ?',
    args: [body.id],
  });
  const passkey = found.rows[0];
  if (!passkey) {
    res.setHeader('Set-Cookie', clearChallengeCookie());
    return res.status(404).json({ error: 'Tento přístupový klíč tu neznáme' });
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge: challenge.c,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      credential: {
        id: passkey.id,
        publicKey: isoBase64URL.toBuffer(passkey.public_key),
        counter: Number(passkey.counter) || 0,
        transports: parseTransports(passkey.transports),
      },
      requireUserVerification: false,
    });
  } catch (err) {
    console.warn('[/api/passkey] authentication rejected:', err.message);
    verification = { verified: false };
  }

  if (!verification.verified) {
    res.setHeader('Set-Cookie', clearChallengeCookie());
    return res.status(400).json({ error: 'Přístupový klíč se nepodařilo ověřit' });
  }

  const ownerId = passkey.user_id;
  await db.execute({
    sql: "UPDATE passkeys SET counter = ?, last_used_at = datetime('now') WHERE id = ?",
    args: [verification.authenticationInfo.newCounter || 0, passkey.id],
  });

  // Jízdy zadané na tomto zařízení před obnovou (anonymní identita bez
  // vlastního klíče) převedeme do obnoveného účtu, aby se neztratily.
  let merged = 0;
  const current = getSession(req);
  if (current && current.userId !== ownerId) {
    const ownKeys = await listUserPasskeys(db, current.userId);
    if (!ownKeys.length) {
      const moved = await db.execute({
        sql: 'UPDATE trips SET user_id = ? WHERE user_id = ?',
        args: [ownerId, current.userId],
      });
      merged = Number(moved.rowsAffected) || 0;
    }
  }

  res.setHeader('Set-Cookie', [createSessionCookie(ownerId), clearChallengeCookie()]);
  return res.status(200).json({ userId: ownerId, merged });
}
