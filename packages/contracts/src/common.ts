import { z } from './zod.js';

/** Money on the wire: integer paise. Offers and prices are whole rupees, so multiples of 100. */
export const PaiseSchema = z.number().int().nonnegative().openapi({ description: 'Integer paise (1 rupee = 100 paise)', example: 250000 });

export const EpochMsSchema = z.number().int().nonnegative().openapi({ description: 'Epoch milliseconds (UTC)' });
