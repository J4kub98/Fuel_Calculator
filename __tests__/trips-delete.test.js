// Testy pro DELETE /api/trips/:id — ověřuje vlastnictví záznamu
jest.mock('../lib/db', () => ({
  initDb: jest.fn().mockResolvedValue(undefined),
  getDb: jest.fn(),
}));

const { getDb } = require('../lib/db');
const handler = require('../api/trips/[id]');

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

const VALID_ID   = '550e8400-e29b-41d4-a716-446655440000';
const VALID_USER = '660e8400-e29b-41d4-a716-446655440001';

beforeEach(() => jest.clearAllMocks());

describe('DELETE /api/trips/[id]', () => {
  it('vrátí 405 pro GET request', async () => {
    const req = { method: 'GET', query: { id: VALID_ID, userId: VALID_USER } };
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('vrátí 400 pro neplatné ID', async () => {
    const req = { method: 'DELETE', query: { id: 'bad-id', userId: VALID_USER } };
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('vrátí 400 pro neplatné userId', async () => {
    const req = { method: 'DELETE', query: { id: VALID_ID, userId: 'bad' } };
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('vrátí 404 když jízda nepatří uživateli', async () => {
    const mockExecute = jest.fn().mockResolvedValue({ rows: [] });
    getDb.mockReturnValue({ execute: mockExecute });

    const req = { method: 'DELETE', query: { id: VALID_ID, userId: VALID_USER } };
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it('smaže jízdu a vrátí 200', async () => {
    const mockExecute = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: VALID_ID }] })
      .mockResolvedValueOnce({});

    getDb.mockReturnValue({ execute: mockExecute });

    const req = { method: 'DELETE', query: { id: VALID_ID, userId: VALID_USER } };
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });
});
