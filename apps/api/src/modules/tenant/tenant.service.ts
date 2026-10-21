import { Injectable, ConflictException } from '@nestjs/common';
import { IndustryType } from '@friendly-crm/shared';
import { INDUSTRY_TEMPLATES } from './templates/industry-templates';

export interface CreateTenantDto {
  name: string;
  slug: string;
  industry: IndustryType;
  ownerPhone: string;
  ownerName?: string;
}

@Injectable()
export class TenantService {
  async onboardTenant(dto: CreateTenantDto) {
    const tenantId = `tenant_${Date.now()}`;
    const template = INDUSTRY_TEMPLATES[dto.industry] || INDUSTRY_TEMPLATES[IndustryType.RETAIL];

    console.log(`[ONBOARDING] Created tenant "${dto.name}" with industry template "${dto.industry}"`);
    console.log(`[SEEDING] Initializing ${template.leadStages.length} lead stages, ${template.orderStages.length} order stages, and ${template.customFields.length} custom fields.`);

    return {
      tenantId,
      name: dto.name,
      slug: dto.slug,
      industry: dto.industry,
      seededPipelineStages: {
        leads: template.leadStages,
        orders: template.orderStages,
      },
      seededCustomFields: template.customFields,
      status: 'ACTIVE',
    };
  }

  async getTenantDetails(tenantId: string) {
    return {
      id: tenantId,
      name: 'Acme Enterprise',
      industry: IndustryType.MANUFACTURING,
      activeMembers: 12,
      createdAt: new Date().toISOString(),
    };
  }
}
