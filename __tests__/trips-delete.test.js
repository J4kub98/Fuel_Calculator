// Testy pro DELETE /api/trips/:id — ověřuje vlastnictví záznamu
jest.mock('../lib/db', () => ({
  initDb: jest.fn().mockResolvedValue(undefined),
  getDb: jest.fn(),
}));

jest.mock('../lib/session', () => ({
  getSession: jest.fn(),
}));

jest.mock('../lib/http', () => ({
  setSecurityHeaders: jest.fn(),
}));

jest.mock('../lib/rateLimit', () => ({
  checkRateLimit: jest.fn(() => ({ ok: true, remaining: 99, retryAfter: 0 })),
}));

const { getDb } = require('../lib/db');
const { getSession } = require('../lib/session');
const handler = require('../api/trips/[id]');

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.setHeader = jest.fn(() => res);
  return res;
}

const VALID_ID   = '550e8400-e29b-41d4-a716-446655440000';
const VALID_USER = '660e8400-e29b-41d4-a716-446655440001';

beforeEach(() => jest.clearAllMocks());

describe('DELETE /api/trips/[id]', () => {
  it('vrátí 405 pro GET request', async () => {
    const req = { method: 'GET', query: { id: VALID_ID } };
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('vrátí 401 bez session', async () => {
    getSession.mockReturnValue(null);
    const req = { method: 'DELETE', query: { id: VALID_ID } };
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('vrátí 400 pro neplatné ID', async () => {
    getSession.mockReturnValue({ userId: VALID_USER });
    const req = { method: 'DELETE', query: { id: 'bad-id' } };
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('vrátí 404 když jízda nepatří uživateli', async () => {
    getSession.mockReturnValue({ userId: VALID_USER });
    const mockExecute = jest.fn().mockResolvedValue({ rows: [] });
    getDb.mockReturnValue({ execute: mockExecute });

    const req = { method: 'DELETE', query: { id: VALID_ID } };
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it('smaže jízdu a vrátí 200', async () => {
    getSession.mockReturnValue({ userId: VALID_USER });
    const mockExecute = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: VALID_ID }] })
      .mockResolvedValueOnce({});

    getDb.mockReturnValue({ execute: mockExecute });

    const req = { method: 'DELETE', query: { id: VALID_ID } };
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });
});
