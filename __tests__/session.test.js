jest.mock('../lib/http', () => ({
  setSecurityHeaders: jest.fn(),
}));

jest.mock('../lib/rateLimit', () => ({
  checkRateLimit: jest.fn(() => ({ ok: true, remaining: 99, retryAfter: 0 })),
}));

const handler = require('../backend/session');

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
      expect.objectContaining({ userId: expect.any(String), migrated: false })
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
    expect(res.json).toHaveBeenCalledWith({ userId: legacyUserId, migrated: true });
  });
});
