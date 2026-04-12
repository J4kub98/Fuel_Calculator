// Testy Zod validačních schémat pro API vstupní data
const { uuidSchema, tripSchema } = require('../lib/validation');

describe('uuidSchema', () => {
  it('přijme platné UUID v4', () => {
    const result = uuidSchema.safeParse('550e8400-e29b-41d4-a716-446655440000');
    expect(result.success).toBe(true);
  });

  it('odmítne náhodný string', () => {
    const result = uuidSchema.safeParse('not-a-uuid');
    expect(result.success).toBe(false);
  });

  it('odmítne UUID v1 (třetí skupina nezačíná 4)', () => {
    const result = uuidSchema.safeParse('550e8400-e29b-11d4-a716-446655440000');
    expect(result.success).toBe(false);
  });

  it('odmítne prázdný string', () => {
    const result = uuidSchema.safeParse('');
    expect(result.success).toBe(false);
  });
});

describe('tripSchema', () => {
  const valid = {
    date: '2026-04-12T10:00:00.000Z',
    distance: 150,
    consumption: 5.9,
    price: 38.5,
    liters: 8.85,
    cost: 340.73,
  };

  it('přijme platná data jízdy', () => {
    expect(tripSchema.safeParse(valid).success).toBe(true);
  });

  it('odmítne zápornou vzdálenost', () => {
    expect(tripSchema.safeParse({ ...valid, distance: -1 }).success).toBe(false);
  });

  it('odmítne nulovou spotřebu', () => {
    expect(tripSchema.safeParse({ ...valid, consumption: 0 }).success).toBe(false);
  });

  it('odmítne příliš vysokou cenu paliva (> 500)', () => {
    expect(tripSchema.safeParse({ ...valid, price: 501 }).success).toBe(false);
  });

  it('odmítne chybějící pole', () => {
    const { cost, ...missing } = valid;
    expect(tripSchema.safeParse(missing).success).toBe(false);
  });
});
