import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { db, tenants } from '@friendly-crm/db';
import {
  CustomFieldDefinition,
  IndustryKey,
  LocalizedString,
  getIndustryTemplate,
  getCustomFieldsForEntity,
  getCustomDataErrors,
  getLeadStages,
} from '@friendly-crm/shared';
import { tenantContextStorage } from '../../common/interceptors/tenant-rls.interceptor';
import { globalMemoryTenants } from '../crm/memory-store';
import { onDbError } from '../../common/utils/db-fallback.util';

type TemplateEntity = 'LEAD' | 'QUOTATION' | 'ORDER';
type Lang = 'en' | 'ta';

/** CustomFieldDefinition plus the full localized labels so clients can switch language offline. */
export interface ResolvedCustomField extends CustomFieldDefinition {
  labels: LocalizedString;
  optionLabels?: Record<string, LocalizedString>;
}

const TEMPLATE_ENTITIES: TemplateEntity[] = ['LEAD', 'QUOTATION', 'ORDER'];

/**
 * Serves tenant workflow configuration (custom fields + pipelines) from the tenant's
 * industry template in packages/shared/src/industry-templates.json.
 */
@Injectable()
export class WorkflowService {
  private readonly logger = new Logger(WorkflowService.name);
  async resolveIndustry(tenantId: string): Promise<IndustryKey> {
    try {
      const store = tenantContextStorage.getStore();
      const activeDb = store?.tx || db;
      const [tenant] = await activeDb
        .select({ industryKey: tenants.industryKey })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);
      if (tenant?.industryKey) return tenant.industryKey as IndustryKey;
    } catch (err: any) {
      onDbError(this.logger, 'reading the business type', err);
    }
    return globalMemoryTenants.get(tenantId)?.industryKey || 'printing';
  }

  private parseEntity(entityType: string): TemplateEntity | 'CUSTOMER' {
    const upper = (entityType || '').toUpperCase();
    if (upper === 'CUSTOMER') return 'CUSTOMER';
    if ((TEMPLATE_ENTITIES as string[]).includes(upper)) return upper as TemplateEntity;
    throw new BadRequestException(
      `Unknown entityType '${entityType}'. Expected one of: CUSTOMER, ${TEMPLATE_ENTITIES.join(', ')}`
    );
  }

  async getCustomFields(
    tenantId: string,
    entityType: string,
    lang: Lang = 'en'
  ): Promise<ResolvedCustomField[]> {
    const entity = this.parseEntity(entityType);
    // Industry templates do not define CUSTOMER-level fields (GST lives on the customer record).
    if (entity === 'CUSTOMER') return [];

    const industry = await this.resolveIndustry(tenantId);
    return getCustomFieldsForEntity(industry, entity).map((f) => ({
      name: f.key,
      label: f.label[lang] || f.label.en,
      labels: f.label,
      type: f.type,
      required: f.required,
      placeholder: f.placeholder,
      options: f.options?.map((o) => o.value),
      optionLabels: f.options
        ? Object.fromEntries(f.options.map((o) => [o.value, o.label]))
        : undefined,
      entityType: entity,
    }));
  }

  async validateDynamicFields(
    tenantId: string,
    entityType: string,
    values: Record<string, any>
  ): Promise<{ valid: boolean; errors?: string[] }> {
    const entity = this.parseEntity(entityType);
    if (entity === 'CUSTOMER') return { valid: true };

    const industry = await this.resolveIndustry(tenantId);
    const errors = getCustomDataErrors(industry, entity, values);
    if (errors.length > 0) {
      throw new BadRequestException({ message: 'Validation failed for custom fields', errors });
    }
    return { valid: true };
  }

  async getPipelines(tenantId: string) {
    const industry = await this.resolveIndustry(tenantId);
    const template = getIndustryTemplate(industry);
    const toStage = (s: { id: string; label: LocalizedString; color: string; outcome?: string }) => ({
      key: s.id,
      name: s.label.en,
      labels: s.label,
      color: s.color,
      ...(s.outcome ? { outcome: s.outcome } : {}),
    });

    return [
      {
        id: `pipe_lead_${industry}`,
        tenantId,
        industry,
        name: `${template.name.en} — Leads`,
        targetEntity: 'LEAD',
        stages: getLeadStages(industry).map(toStage),
      },
      {
        id: `pipe_order_${industry}`,
        tenantId,
        industry,
        name: `${template.name.en} — Orders`,
        targetEntity: 'ORDER',
        stages: template.orderStages.map(toStage),
      },
    ];
  }
}
