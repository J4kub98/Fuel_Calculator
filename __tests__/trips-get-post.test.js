// Testy pro GET (seznam jízd) a POST (nová jízda) /api/trips
jest.mock('../lib/db', () => ({
  initDb: jest.fn().mockResolvedValue(undefined),
  getDb: jest.fn(),
}));

const { getDb } = require('../lib/db');
const handler = require('../api/trips');

// Helper — mockuje Express-style res objekt
function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

const VALID_USER = '550e8400-e29b-41d4-a716-446655440000';

const VALID_BODY = {
  userId: VALID_USER,
  date: '2026-04-12T10:00:00.000Z',
  distance: 150,
  consumption: 5.9,
  price: 38.5,
  liters: 8.85,
  cost: 340.73,
};

beforeEach(() => jest.clearAllMocks());

describe('GET /api/trips', () => {
  it('vrátí 400 pro neplatné userId', async () => {
    const req = { method: 'GET', query: { userId: 'not-a-uuid' } };
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Neplatné userId' });
  });

  it('vrátí 400 pro chybějící userId', async () => {
    const req = { method: 'GET', query: {} };
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('vrátí seznam jízd pro platné userId', async () => {
    const rows = [{ id: 'trip-1', user_id: VALID_USER, distance: 100 }];
    const mockExecute = jest.fn().mockResolvedValue({ rows });
    getDb.mockReturnValue({ execute: mockExecute });

    const req = { method: 'GET', query: { userId: VALID_USER } };
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(rows);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining('WHERE user_id = ?'),
        args: [VALID_USER],
      })
    );
  });
});

describe('POST /api/trips', () => {
  it('vrátí 400 pro neúplná data', async () => {
    const req = { method: 'POST', body: { userId: VALID_USER } };
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('vrátí 400 pro zápornou vzdálenost', async () => {
    const req = { method: 'POST', body: { ...VALID_BODY, distance: -10 } };
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('uloží jízdu a vrátí 201 s vygenerovaným ID', async () => {
    const mockExecute = jest.fn().mockResolvedValue({});
    getDb.mockReturnValue({ execute: mockExecute });

    const req = { method: 'POST', body: VALID_BODY };
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.any(String),
        distance: 150,
        cost: 340.73,
      })
    );
    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining('INSERT INTO trips'),
      })
    );
  });

  it('vrátí 405 pro nepodporovanou metodu', async () => {
    const req = { method: 'PUT', query: {}, body: {} };
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });
});
