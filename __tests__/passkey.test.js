// Testy pro /api/passkey — záloha a obnova identity přístupovým klíčem
jest.mock('../lib/db', () => ({
  initDb: jest.fn().mockResolvedValue(undefined),
  getDb: jest.fn(),
}));

jest.mock('../lib/http', () => ({
  setSecurityHeaders: jest.fn(),
}));

jest.mock('../lib/rateLimit', () => ({
  checkRateLimit: jest.fn(() => ({ ok: true, remaining: 99, retryAfter: 0 })),
}));

jest.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: jest.fn(async () => ({ challenge: 'reg-challenge', rp: {}, user: {} })),
  verifyRegistrationResponse: jest.fn(),
  generateAuthenticationOptions: jest.fn(async () => ({ challenge: 'auth-challenge' })),
  verifyAuthenticationResponse: jest.fn(),
}));

const webauthn = require('@simplewebauthn/server');
const { getDb } = require('../lib/db');
const { createSessionCookie } = require('../lib/session');
const { createChallengeCookie } = require('../lib/webauthn');
const handler = require('../backend/passkey');

const USER = '550e8400-e29b-41d4-a716-446655440000';
const OTHER = '550e8400-e29b-41d4-a716-446655440001';
const HOST = { host: 'fuel.example.com', 'x-forwarded-proto': 'https' };

function mockRes() {
  const res = { headers: {} };
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.setHeader = jest.fn((key, value) => {
    res.headers[key] = value;
    return res;
  });
  return res;
}

function cookieValue(setCookie) {
  return setCookie.split(';')[0];
}

function cookies(...values) {
  return values.map(cookieValue).join('; ');
}

// Jednoduchý mock DB: odpovědi podle začátku SQL dotazu
function mockDb(handlers) {
  const execute = jest.fn(async (query) => {
    const sql = typeof query === 'string' ? query : query.sql;
    const args = typeof query === 'string' ? [] : query.args;
    for (const [prefix, fn] of handlers) {
      if (sql.trim().startsWith(prefix)) return fn(args);
    }
    return { rows: [], rowsAffected: 0 };
  });
  getDb.mockReturnValue({ execute });
  return execute;
}

beforeEach(() => {
  process.env.SESSION_SECRET = 'test-session-secret-123456789';
  delete process.env.WEBAUTHN_ORIGINS;
  jest.clearAllMocks();
});

afterAll(() => {
  delete process.env.SESSION_SECRET;
});

describe('GET /api/passkey', () => {
  it('vrati 401 bez session', async () => {
    mockDb([]);
    const res = mockRes();
    await handler({ method: 'GET', query: {}, headers: HOST }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('vrati pocet klicu uzivatele', async () => {
    mockDb([['SELECT id, transports FROM passkeys', () => ({ rows: [{ id: 'a' }, { id: 'b' }] })]]);
    const res = mockRes();
    await handler({
      method: 'GET',
      query: {},
      headers: { ...HOST, cookie: cookies(createSessionCookie(USER)) },
    }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ count: 2 });
  });
});

describe('registrace', () => {
  it('options vyzaduje session', async () => {
    mockDb([]);
    const res = mockRes();
    await handler({ method: 'POST', query: { flow: 'register', step: 'options' }, headers: HOST, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('options vrati vyzvu, vyloucene klice a nastavi podepsanou cookie', async () => {
    mockDb([['SELECT id, transports FROM passkeys', () => ({ rows: [{ id: 'existing', transports: '["internal"]' }] })]]);
    const res = mockRes();
    await handler({
      method: 'POST',
      query: { flow: 'register', step: 'options' },
      headers: { ...HOST, cookie: cookies(createSessionCookie(USER)) },
      body: {},
    }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const args = webauthn.generateRegistrationOptions.mock.calls[0][0];
    expect(args.rpID).toBe('fuel.example.com');
    expect(args.excludeCredentials).toEqual([{ id: 'existing', transports: ['internal'] }]);
    expect(args.authenticatorSelection.residentKey).toBe('required');
    expect(res.headers['Set-Cookie']).toContain('fuel_wa=');
  });

  it('verify odmitne pozadavek bez platne vyzvy', async () => {
    mockDb([]);
    const res = mockRes();
    await handler({
      method: 'POST',
      query: { flow: 'register', step: 'verify' },
      headers: { ...HOST, cookie: cookies(createSessionCookie(USER)) },
      body: { id: 'cred' },
    }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(webauthn.verifyRegistrationResponse).not.toHaveBeenCalled();
  });

  it('verify odmitne vyzvu vydanou jinemu uzivateli', async () => {
    mockDb([]);
    const res = mockRes();
    await handler({
      method: 'POST',
      query: { flow: 'register', step: 'verify' },
      headers: {
        ...HOST,
        cookie: cookies(createSessionCookie(USER), createChallengeCookie({ f: 'reg', c: 'x', u: OTHER })),
      },
      body: { id: 'cred' },
    }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('verify ulozi overeny klic', async () => {
    const execute = mockDb([['SELECT id, transports FROM passkeys', () => ({ rows: [{ id: 'cred-1' }] })]]);
    webauthn.verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: { id: 'cred-1', publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ['internal', 'hybrid'] },
        credentialDeviceType: 'multiDevice',
        credentialBackedUp: true,
      },
    });
    const res = mockRes();
    await handler({
      method: 'POST',
      query: { flow: 'register', step: 'verify' },
      headers: {
        ...HOST,
        cookie: cookies(createSessionCookie(USER), createChallengeCookie({ f: 'reg', c: 'reg-challenge', u: USER })),
      },
      body: { id: 'cred-1', response: {} },
    }, res);

    expect(webauthn.verifyRegistrationResponse).toHaveBeenCalledWith(expect.objectContaining({
      expectedChallenge: 'reg-challenge',
      expectedOrigin: 'https://fuel.example.com',
      expectedRPID: 'fuel.example.com',
    }));
    const insert = execute.mock.calls.find(([q]) => q.sql && q.sql.includes('INSERT OR IGNORE INTO passkeys'));
    expect(insert[0].args).toEqual(['cred-1', USER, 'AQID', 0, '["internal","hybrid"]', 'multiDevice', 1]);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ verified: true, count: 1, backedUp: true });
  });

  it('verify vrati 400 kdyz overeni selze', async () => {
    const execute = mockDb([]);
    webauthn.verifyRegistrationResponse.mockRejectedValue(new Error('Unexpected origin'));
    const res = mockRes();
    await handler({
      method: 'POST',
      query: { flow: 'register', step: 'verify' },
      headers: {
        ...HOST,
        cookie: cookies(createSessionCookie(USER), createChallengeCookie({ f: 'reg', c: 'reg-challenge', u: USER })),
      },
      body: { id: 'cred-1' },
    }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(execute.mock.calls.some(([q]) => q.sql && q.sql.includes('INSERT'))).toBe(false);
  });
});

describe('prihlaseni (obnova)', () => {
  const STORED = { id: 'cred-1', user_id: USER, public_key: 'AQID', counter: 0, transports: '["internal"]' };

  it('options nevyzaduje session', async () => {
    mockDb([]);
    const res = mockRes();
    await handler({ method: 'POST', query: { flow: 'login', step: 'options' }, headers: HOST, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ challenge: 'auth-challenge' });
    expect(res.headers['Set-Cookie']).toContain('fuel_wa=');
  });

  it('verify vrati 404 pro neznamy klic', async () => {
    mockDb([['SELECT id, user_id', () => ({ rows: [] })]]);
    const res = mockRes();
    await handler({
      method: 'POST',
      query: { flow: 'login', step: 'verify' },
      headers: { ...HOST, cookie: cookies(createChallengeCookie({ f: 'auth', c: 'auth-challenge' })) },
      body: { id: 'unknown' },
    }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('verify neprijme vyzvu z registrace', async () => {
    mockDb([]);
    const res = mockRes();
    await handler({
      method: 'POST',
      query: { flow: 'login', step: 'verify' },
      headers: { ...HOST, cookie: cookies(createChallengeCookie({ f: 'reg', c: 'x', u: USER })) },
      body: { id: 'cred-1' },
    }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('verify prepne session na vlastnika klice a slouci jizdy anonymni identity', async () => {
    const execute = mockDb([
      ['SELECT id, user_id', () => ({ rows: [STORED] })],
      ['SELECT id, transports FROM passkeys', () => ({ rows: [] })],
      ['UPDATE trips', () => ({ rows: [], rowsAffected: 2 })],
    ]);
    webauthn.verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 5 },
    });
    const res = mockRes();
    await handler({
      method: 'POST',
      query: { flow: 'login', step: 'verify' },
      headers: {
        ...HOST,
        cookie: cookies(createSessionCookie(OTHER), createChallengeCookie({ f: 'auth', c: 'auth-challenge' })),
      },
      body: { id: 'cred-1' },
    }, res);

    expect(webauthn.verifyAuthenticationResponse).toHaveBeenCalledWith(expect.objectContaining({
      expectedChallenge: 'auth-challenge',
      expectedRPID: 'fuel.example.com',
      credential: expect.objectContaining({ id: 'cred-1', counter: 0, transports: ['internal'] }),
    }));
    const merge = execute.mock.calls.find(([q]) => q.sql && q.sql.startsWith('UPDATE trips'));
    expect(merge[0].args).toEqual([USER, OTHER]);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ userId: USER, merged: 2 });
    const setCookies = res.headers['Set-Cookie'];
    expect(Array.isArray(setCookies)).toBe(true);
    expect(setCookies[0]).toContain('fuel_sid=');
  });

  it('neslucuje jizdy identity, ktera ma vlastni klic', async () => {
    const execute = mockDb([
      ['SELECT id, user_id', () => ({ rows: [STORED] })],
      ['SELECT id, transports FROM passkeys', () => ({ rows: [{ id: 'own-key' }] })],
    ]);
    webauthn.verifyAuthenticationResponse.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 1 } });
    const res = mockRes();
    await handler({
      method: 'POST',
      query: { flow: 'login', step: 'verify' },
      headers: {
        ...HOST,
        cookie: cookies(createSessionCookie(OTHER), createChallengeCookie({ f: 'auth', c: 'auth-challenge' })),
      },
      body: { id: 'cred-1' },
    }, res);
    expect(execute.mock.calls.some(([q]) => q.sql && q.sql.startsWith('UPDATE trips'))).toBe(false);
    expect(res.json).toHaveBeenCalledWith({ userId: USER, merged: 0 });
  });

  it('verify bez prihlaseni vrati 400 pri neplatnem podpisu', async () => {
    mockDb([['SELECT id, user_id', () => ({ rows: [STORED] })]]);
    webauthn.verifyAuthenticationResponse.mockResolvedValue({ verified: false, authenticationInfo: {} });
    const res = mockRes();
    await handler({
      method: 'POST',
      query: { flow: 'login', step: 'verify' },
      headers: { ...HOST, cookie: cookies(createChallengeCookie({ f: 'auth', c: 'auth-challenge' })) },
      body: { id: 'cred-1' },
    }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(String(res.headers['Set-Cookie'])).not.toContain('fuel_sid=');
  });
});

describe('domena (relying party)', () => {
  it('odmitne nezabezpecene http mimo localhost', async () => {
    mockDb([]);
    const res = mockRes();
    await handler({
      method: 'POST',
      query: { flow: 'login', step: 'options' },
      headers: { host: 'fuel.example.com', 'x-forwarded-proto': 'http' },
      body: {},
    }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('povoli localhost pres http', async () => {
    mockDb([]);
    const res = mockRes();
    await handler({ method: 'POST', query: { flow: 'login', step: 'options' }, headers: { host: 'localhost:3000' }, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(webauthn.generateAuthenticationOptions).toHaveBeenCalledWith(expect.objectContaining({ rpID: 'localhost' }));
  });

  it('respektuje allowlist WEBAUTHN_ORIGINS', async () => {
    process.env.WEBAUTHN_ORIGINS = 'https://allowed.example.com';
    mockDb([]);
    const res = mockRes();
    await handler({ method: 'POST', query: { flow: 'login', step: 'options' }, headers: HOST, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
