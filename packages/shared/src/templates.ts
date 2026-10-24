import industryTemplatesData from './industry-templates.json';
import { z } from 'zod';

export type IndustryKey = 'printing' | 'furniture' | 'textiles' | 'trading';

export interface LocalizedString {
  en: string;
  ta: string;
}

export interface OrderStageConfig {
  id: string;
  label: LocalizedString;
  color: string;
}

export interface CustomFieldOption {
  value: string;
  label: LocalizedString;
}

export interface CustomFieldConfig {
  key: string;
  entity: Array<'LEAD' | 'QUOTATION' | 'ORDER'>;
  type: 'TEXT' | 'SELECT' | 'MULTI_SELECT' | 'NUMBER' | 'BOOLEAN';
  required: boolean;
  label: LocalizedString;
  placeholder?: string;
  options?: CustomFieldOption[];
}

export interface LeadStageConfig extends OrderStageConfig {
  /** Marks a terminal stage. Omit for in-progress stages. */
  outcome?: 'WON' | 'LOST';
}

export interface IndustryTemplate {
  key: IndustryKey;
  name: LocalizedString;
  /** Optional per-industry lead pipeline. Falls back to DEFAULT_LEAD_STAGES. */
  leadStages?: LeadStageConfig[];
  orderStages: OrderStageConfig[];
  customFields: CustomFieldConfig[];
}

/**
 * Lead pipeline used when a template does not define its own `leadStages`.
 * Stage ids must stay in sync with LeadStageEnum in dtos/crm.dto.ts.
 */
export const DEFAULT_LEAD_STAGES: LeadStageConfig[] = [
  { id: 'NEW', label: { en: 'New Lead', ta: 'புதிய லீட்' }, color: '#3B82F6' },
  { id: 'QUALIFIED', label: { en: 'Qualified', ta: 'தகுதியானது' }, color: '#8B5CF6' },
  { id: 'QUOTED', label: { en: 'Quoted', ta: 'மேற்கோள் அனுப்பப்பட்டது' }, color: '#F4B860' },
  { id: 'NEGOTIATION', label: { en: 'Negotiation', ta: 'பேச்சுவார்த்தை' }, color: '#EC4899' },
  { id: 'WON', label: { en: 'Won', ta: 'வெற்றி' }, color: '#10B981', outcome: 'WON' },
  { id: 'LOST', label: { en: 'Lost', ta: 'இழந்தது' }, color: '#EF4444', outcome: 'LOST' },
];

const rawTemplates = (industryTemplatesData as any)?.default || industryTemplatesData;
export const INDUSTRY_TEMPLATES: Record<string, IndustryTemplate> = (
  rawTemplates || require('./industry-templates.json')
) as Record<string, IndustryTemplate>;

export function getIndustryTemplate(key: string): IndustryTemplate {
  const template = INDUSTRY_TEMPLATES[key.toLowerCase()];
  if (!template) {
    // Default to printing if unknown
    return INDUSTRY_TEMPLATES['printing'];
  }
  return template;
}

export function isIndustryKey(key: unknown): key is IndustryKey {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(INDUSTRY_TEMPLATES, key.toLowerCase());
}

export function getLeadStages(industryKey: string): LeadStageConfig[] {
  return getIndustryTemplate(industryKey).leadStages ?? DEFAULT_LEAD_STAGES;
}

export function getCustomFieldsForEntity(
  industryKey: string,
  entity: 'LEAD' | 'QUOTATION' | 'ORDER'
): CustomFieldConfig[] {
  const template = getIndustryTemplate(industryKey);
  return template.customFields.filter((f) => f.entity.includes(entity));
}

/**
 * Dynamically builds a Zod schema for validating customData against an industry template
 */
export function buildCustomDataZodSchema(
  industryKey: string,
  entity: 'LEAD' | 'QUOTATION' | 'ORDER' = 'LEAD'
): z.ZodObject<any> {
  const fields = getCustomFieldsForEntity(industryKey, entity);
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const field of fields) {
    let schema: z.ZodTypeAny;

    switch (field.type) {
      case 'SELECT': {
        const allowedValues = field.options?.map((o) => o.value) || [];
        schema = allowedValues.length > 0
          ? z.enum(allowedValues as [string, ...string[]], {
              errorMap: () => ({
                message: `Invalid selection for ${field.key}. Must be one of: ${allowedValues.join(', ')}`,
              }),
            })
          : z.string();
        break;
      }
      case 'MULTI_SELECT': {
        const allowedValues = field.options?.map((o) => o.value) || [];
        schema = z.array(
          z.string().refine((val) => allowedValues.includes(val), {
            message: `Invalid option in ${field.key}`,
          })
        );
        break;
      }
      case 'NUMBER': {
        schema = z.coerce.number();
        break;
      }
      case 'BOOLEAN': {
        // z.coerce.boolean() turns the string "false" into true, so map strings explicitly.
        schema = z.preprocess(
          (v) => (v === 'true' ? true : v === 'false' ? false : v),
          z.boolean()
        );
        break;
      }
      case 'TEXT':
      default: {
        schema = z.string();
        if (field.required) {
          schema = (schema as z.ZodString).min(1, `${field.label.en} (${field.label.ta}) is required`);
        }
        break;
      }
    }

    if (!field.required) {
      schema = schema.optional().nullable();
    }

    shape[field.key] = schema;
  }

  return z.object(shape).passthrough();
}

/**
 * Returns human-readable validation errors for customData (empty array when valid).
 */
export function getCustomDataErrors(
  industryKey: string,
  entity: 'LEAD' | 'QUOTATION' | 'ORDER',
  data: unknown
): string[] {
  const result = buildCustomDataZodSchema(industryKey, entity).safeParse(data || {});
  if (result.success) return [];
  return result.error.errors.map((err) => `${err.path.join('.')}: ${err.message}`);
}

/**
 * Validates customData directly, throwing a structured error if invalid
 */
export function validateCustomData(
  industryKey: string,
  entity: 'LEAD' | 'QUOTATION' | 'ORDER',
  data: unknown
): Record<string, any> {
  const schema = buildCustomDataZodSchema(industryKey, entity);
  const result = schema.safeParse(data || {});

  if (!result.success) {
    const errorMessages = getCustomDataErrors(industryKey, entity, data);
    throw new Error(`Validation failed for ${industryKey} ${entity} customData: ${errorMessages.join('; ')}`);
  }

  return result.data;
}
