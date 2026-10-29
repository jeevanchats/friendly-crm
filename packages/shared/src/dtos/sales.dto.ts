import { z } from 'zod';

export const QuoteLineItemSchema = z.object({
  id: z.string().uuid().optional(),
  /** The product-list entry this line was made from (a line without one is free text). */
  productId: z.string().uuid().optional().nullable(),
  itemName: z.string().optional(),
  description: z.string().optional(),
  quantity: z.coerce.number().gt(0, 'Quantity must be greater than 0'),
  unit: z.string().optional(),
  /** HSN (goods) or SAC (services) code, 4, 6 or 8 digits. Needed to issue a GST invoice. */
  hsnCode: z.string().regex(/^\d{4}(\d{2}(\d{2})?)?$/, 'HSN/SAC code must be 4, 6 or 8 digits').optional().nullable(),
  unitPrice: z.coerce.number().min(0, 'Unit price cannot be negative'),
  taxPercent: z.coerce.number().min(0, 'Tax percent cannot be negative').max(100, 'Tax percent cannot exceed 100').optional(),
  discountPercent: z.coerce.number().min(0).max(100).optional(),
  total: z.coerce.number().optional(),
});

export type QuoteLineItemDto = z.infer<typeof QuoteLineItemSchema>;

// Alias for backwards-compatibility
export const QuotationItemSchema = QuoteLineItemSchema;
export type QuotationItemDto = QuoteLineItemDto;

export const CreateQuotationSchema = z.object({
  customerId: z.string().min(1, 'Customer ID is required').optional(),
  leadId: z.string().optional().nullable(),
  discountAmount: z.coerce.number().min(0, 'Discount cannot be negative').default(0),
  validDays: z.coerce.number().int().positive().optional().default(15),
  validUntil: z.string().optional().nullable(),
  termsAndConditions: z.string().optional().nullable(),
  customData: z.record(z.unknown()).optional().default({}),
  items: z.array(QuoteLineItemSchema).min(1, 'Quotation must contain at least one line item'),
  idempotencyKey: z.string().optional(),
});

export type CreateQuotationDto = z.infer<typeof CreateQuotationSchema>;

export const ConvertQuoteToOrderSchema = z.object({
  advanceReceived: z.coerce.number().min(0, 'Advance amount cannot be negative').optional(),
  advanceAmount: z.coerce.number().min(0, 'Advance amount cannot be negative').optional(),
  paymentMode: z.string().optional(),
  paymentReference: z.string().optional(),
  notes: z.string().optional().nullable(),
  expectedDeliveryAt: z.string().optional().nullable(),
  industryKey: z.string().optional(),
  idempotencyKey: z.string().optional(),
});

export type ConvertQuoteToOrderDto = z.infer<typeof ConvertQuoteToOrderSchema>;

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
  nextStageId: z.string().min(1, 'nextStageId is required'),
  customDataUpdates: z.record(z.unknown()).optional(),
  notes: z.string().optional().nullable(),
});

export type UpdateOrderStageDto = z.infer<typeof UpdateOrderStageSchema>;

export const RecordPaymentSchema = z.object({
  orderId: z.string().optional(),
  amount: z.coerce.number().gt(0, 'Payment amount must be greater than zero'),
  mode: z.string().optional().default('UPI'),
  referenceNo: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  idempotencyKey: z.string().optional(),
});

export type RecordPaymentDto = z.infer<typeof RecordPaymentSchema>;

export const QuotationPdfItemSchema = z.object({
  id: z.string().optional(),
  itemName: z.string().optional(),
  description: z.string().optional(),
  quantity: z.coerce.number(),
  unit: z.string().optional(),
  unitPrice: z.union([z.number(), z.string()]).optional().nullable(),
  taxPercent: z.union([z.number(), z.string()]).optional().nullable(),
  total: z.union([z.number(), z.string()]).optional().nullable(),
  lineTotal: z.union([z.number(), z.string()]).optional().nullable(),
});

export const QuotationPdfDataSchema = z.object({
  quoteNumber: z.string(),
  validUntil: z.union([z.string(), z.date()]).optional(),
  items: z.array(QuotationPdfItemSchema).optional(),
  subtotal: z.union([z.string(), z.number()]).optional().nullable(),
  subTotal: z.union([z.string(), z.number()]).optional().nullable(),
  taxTotal: z.union([z.string(), z.number()]).optional().nullable(),
  discountTotal: z.union([z.string(), z.number()]).optional().nullable(),
  grandTotal: z.union([z.string(), z.number()]).optional().nullable(),
});

export type QuotationPdfData = z.infer<typeof QuotationPdfDataSchema>;
export type QuotationPdfDto = QuotationPdfData;

