// Zod validační schémata pro vstupní data API endpointů
const { z } = require('zod');

// UUID v4 — třetí skupina začíná 4, čtvrtá začíná 8, 9, a nebo b
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const uuidSchema = z.string().regex(UUID_REGEX, 'Neplatné UUID v4');

// Rozsahy odpovídají reálným hodnotám — ochrana proti nevalidním vstupům
const tripSchema = z.object({
  date: z.string().datetime(),
  distance: z.number().positive().max(5000),
  consumption: z.number().positive().max(50),
  price: z.number().positive().max(500),
  liters: z.number().nonnegative().max(2500),
  cost: z.number().nonnegative().max(250000),
});

module.exports = { uuidSchema, tripSchema };
