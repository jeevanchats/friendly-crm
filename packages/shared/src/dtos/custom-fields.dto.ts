import { z } from 'zod';

export const CustomFieldTypeEnum = z.enum([
  'TEXT',
  'NUMBER',
  'DATE',
  'SELECT',
  'MULTI_SELECT',
  'BOOLEAN',
]);

export type CustomFieldType = z.infer<typeof CustomFieldTypeEnum>;

export const CustomFieldDefinitionSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  label: z.string().min(1),
  type: CustomFieldTypeEnum,
  required: z.boolean().default(false),
  options: z.array(z.string()).optional(),
  defaultValue: z.any().optional(),
  placeholder: z.string().optional(),
  entityType: z.enum(['LEAD', 'CUSTOMER', 'ORDER', 'QUOTATION']),
});

export type CustomFieldDefinition = z.infer<typeof CustomFieldDefinitionSchema>;

export const DynamicFieldValueSchema = z.record(z.any());
export type DynamicFieldValue = z.infer<typeof DynamicFieldValueSchema>;
