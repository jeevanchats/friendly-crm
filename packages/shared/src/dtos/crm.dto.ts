import { z } from 'zod';

export const LeadSourceEnum = z.enum([
  'WHATSAPP',
  'PHONE',
  'WALK_IN',
  'WEBSITE',
  'REFERRAL',
]);
export type LeadSource = z.infer<typeof LeadSourceEnum>;

export const LeadStageEnum = z.enum([
  'NEW',
  'QUALIFIED',
  'QUOTED',
  'NEGOTIATION',
  'WON',
  'LOST',
]);
export type LeadStage = z.infer<typeof LeadStageEnum>;

export const LeadPriorityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export type LeadPriority = z.infer<typeof LeadPriorityEnum>;

export const TaskTypeEnum = z.enum([
  'FOLLOW_UP_CALL',
  'WHATSAPP',
  'PAYMENT_REMINDER',
  'SITE_VISIT',
]);
export type TaskType = z.infer<typeof TaskTypeEnum>;

export const TaskStatusEnum = z.enum(['PENDING', 'COMPLETED', 'CANCELLED']);
export type TaskStatus = z.infer<typeof TaskStatusEnum>;

/**
 * POST /api/crm/intake-lead DTO Schema
 * Ingests incoming lead while auto-matching/creating customer profile
 */
export const IntakeLeadSchema = z
  .object({
    // Customer Profile fields (accepts name or customerName)
    name: z.string().optional().nullable(),
    customerName: z.string().optional().nullable(),
    phone: z
      .string()
      .min(10, 'Valid 10+ digit phone number required')
      .max(25),
    companyName: z.string().optional().nullable(),
    whatsappNumber: z.string().optional().nullable(),
    email: z.string().email().optional().nullable().or(z.literal('')),

    // Lead Details
    title: z.string().optional().nullable(),
    source: LeadSourceEnum.default('WHATSAPP'),
    stage: LeadStageEnum.default('NEW'),
    priority: LeadPriorityEnum.default('MEDIUM'),
    estimatedValue: z.coerce.number().nonnegative().optional().nullable(),
    notes: z.string().optional().nullable(),
    followUpDueAt: z.string().optional().nullable(),
    assignedToId: z.string().uuid().optional().nullable(),

    // Industry-specific intake parameters (validated dynamically against industry-templates.json)
    customData: z.record(z.unknown()).default({}),
  })
  .transform((data) => {
    const resolvedName = (data.name || data.customerName || 'Inquiry Contact').trim();
    return {
      ...data,
      name: resolvedName,
      customerName: resolvedName,
      title: (data.title || `Inquiry from ${resolvedName}`).trim(),
    };
  });

export type IntakeLeadDto = z.infer<typeof IntakeLeadSchema>;

/**
 * PATCH /api/crm/leads/:id/stage DTO Schema
 */
export const UpdateLeadStageSchema = z.object({
  stage: z.string().min(1, 'Target stage is required'),
  notes: z.string().optional().nullable(),
});

export type UpdateLeadStageDto = z.infer<typeof UpdateLeadStageSchema>;

/**
 * POST /api/crm/tasks DTO Schema
 */
export const CreateCrmTaskSchema = z.object({
  title: z.string().min(3, 'Task title is required (min 3 chars)'),
  type: TaskTypeEnum.default('FOLLOW_UP_CALL'),
  dueAt: z.string().datetime({ message: 'dueAt must be a valid ISO 8601 datetime' }),
  leadId: z.string().uuid().optional().nullable(),
  customerId: z.string().uuid().optional().nullable(),
  assignedToId: z.string().uuid().optional().nullable(),
  outcomeNote: z.string().optional().nullable(),
});

export type CreateCrmTaskDto = z.infer<typeof CreateCrmTaskSchema>;

/**
 * Query filter for GET /api/crm/leads
 */
export const LeadFilterQuerySchema = z.object({
  stage: z.string().optional(),
  priority: LeadPriorityEnum.optional(),
  source: LeadSourceEnum.optional(),
  search: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
});

export type LeadFilterQueryDto = z.infer<typeof LeadFilterQuerySchema>;
