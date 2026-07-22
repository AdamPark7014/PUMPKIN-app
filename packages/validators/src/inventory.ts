import { z } from 'zod';

export const createHoldSchema = z.object({
  eventId: z.string().min(1),
  seatIds: z.array(z.string()).optional(),
  offerId: z.string().optional(),
  quantity: z.number().int().min(1).max(20).default(1),
  sessionId: z.string().optional(),
});

export type CreateHoldInput = z.infer<typeof createHoldSchema>;
