import { z } from 'zod';

export const QuotationItemSchema = z.object({
  id: z.string().uuid().optional(),
  description: z.string().min(1, 'Item description required'),
  quantity: z.number().positive('Quantity must be greater than 0'),
  unitPrice: z.number().nonnegative('Unit price must be non-negative'),
  discountPercent: z.number().min(0).max(100).default(0),
  taxPercent: z.number().min(0).default(18), // standard GST default
  total: z.number().nonnegative(),
});

export type QuotationItemDto = z.infer<typeof QuotationItemSchema>;

export const CreateQuotationSchema = z.object({
  quoteNumber: z.string().optional(),
  customerId: z.string().uuid('Customer ID required'),
  leadId: z.string().uuid().optional(),
  validUntil: z.string().datetime(),
  items: z.array(QuotationItemSchema).min(1, 'At least one item required'),
  subtotal: z.number().nonnegative(),
  taxTotal: z.number().nonnegative(),
  discountTotal: z.number().nonnegative().default(0),
  grandTotal: z.number().positive('Grand total must be positive'),
  notes: z.string().optional(),
  termsAndConditions: z.string().optional(),
});

export type CreateQuotationDto = z.infer<typeof CreateQuotationSchema>;

export const OrderStatusEnum = z.enum([
  'PENDING',
  'CONFIRMED',
  'IN_PRODUCTION',
  'READY_FOR_DELIVERY',
  'DISPATCHED',
  'DELIVERED',
  'COMPLETED',
  'CANCELLED',
]);

export type OrderStatus = z.infer<typeof OrderStatusEnum>;

export const UpdateOrderStageSchema = z.object({
  orderId: z.string().uuid(),
  stage: OrderStatusEnum,
  notes: z.string().optional(),
});

export type UpdateOrderStageDto = z.infer<typeof UpdateOrderStageSchema>;
