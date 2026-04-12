jest.mock('../lib/http', () => ({
  setSecurityHeaders: jest.fn(),
}));

jest.mock('../lib/rateLimit', () => ({
  checkRateLimit: jest.fn(() => ({ ok: true, remaining: 99, retryAfter: 0 })),
}));

const handler = require('../backend/session');
const { createSessionCookie } = require('../lib/session');

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.setHeader = jest.fn(() => res);
  return res;
}

beforeEach(() => {
  process.env.SESSION_SECRET = 'test-session-secret-123456789';
  jest.clearAllMocks();
});

afterAll(() => {
  delete process.env.SESSION_SECRET;
});

describe('POST /api/session', () => {
  it('vrati 400 pro neplatne legacyUserId', async () => {
    const req = { method: 'POST', body: { legacyUserId: 'bad' }, headers: {} };
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('vytvori novou session a nastavi cookie', async () => {
    const req = { method: 'POST', body: {}, headers: {} };
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.setHeader).toHaveBeenCalledWith(
      'Set-Cookie',
      expect.stringContaining('fuel_sid=')
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: expect.any(String),
        migrated: false,
        switched: false,
      })
    );
  });

  it('prevezme validni legacyUserId', async () => {
    const legacyUserId = '550e8400-e29b-41d4-a716-446655440000';
    const req = {
      method: 'POST',
      body: { legacyUserId },
      headers: {},
    };
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      userId: legacyUserId,
      migrated: true,
      switched: false,
    });
  });

  it('pri existujici session bez force vrati puvodni userId', async () => {
    const existingUserId = '550e8400-e29b-41d4-a716-446655440000';
    const req = {
      method: 'POST',
      body: { legacyUserId: '550e8400-e29b-41d4-a716-446655440001' },
      headers: { cookie: createSessionCookie(existingUserId).split(';')[0] },
    };
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.setHeader).not.toHaveBeenCalledWith('Set-Cookie', expect.any(String));
    expect(res.json).toHaveBeenCalledWith({
      userId: existingUserId,
      migrated: false,
      switched: false,
    });
  });

  it('vrati 400 pro force bez legacyUserId', async () => {
    const req = { method: 'POST', body: { force: true }, headers: {} };
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('pri force prepnuti vytvori novou session pro importovane ID', async () => {
    const existingUserId = '550e8400-e29b-41d4-a716-446655440000';
    const importedUserId = '550e8400-e29b-41d4-a716-446655440001';
    const req = {
      method: 'POST',
      body: { legacyUserId: importedUserId, force: true },
      headers: { cookie: createSessionCookie(existingUserId).split(';')[0] },
    };
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.setHeader).toHaveBeenCalledWith(
      'Set-Cookie',
      expect.stringContaining('fuel_sid=')
    );
    expect(res.json).toHaveBeenCalledWith({
      userId: importedUserId,
      migrated: true,
      switched: true,
    });
  });
});
