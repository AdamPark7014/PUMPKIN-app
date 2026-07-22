import { z } from 'zod';

export const createOrderSchema = z.object({
  eventId: z.string().min(1),
  holdIds: z.array(z.string()).min(1),
  buyerName: z.string().min(1),
  buyerEmail: z.string().email(),
  buyerPhone: z.string().optional(),
  promotionCode: z.string().optional(),
  paymentMethod: z.enum(['CARD', 'CASH', 'OXXO', 'SPEI', 'CLIP', 'BANK_TRANSFER']).default('CARD'),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
