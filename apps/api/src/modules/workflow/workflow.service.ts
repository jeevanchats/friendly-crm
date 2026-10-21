import { Injectable, BadRequestException } from '@nestjs/common';
import { CustomFieldDefinition } from '@friendly-crm/shared';

@Injectable()
export class WorkflowService {
  // Mock tenant custom field schema registry
  private fieldDefinitions: Record<string, CustomFieldDefinition[]> = {};

  async getCustomFields(tenantId: string, entityType: string): Promise<CustomFieldDefinition[]> {
    return (
      this.fieldDefinitions[tenantId]?.filter((f) => f.entityType === entityType) || [
        {
          id: 'cf_1',
          name: 'gstNumber',
          label: 'GST Number',
          type: 'TEXT',
          required: true,
          entityType: 'CUSTOMER',
        },
        {
          id: 'cf_2',
          name: 'membershipTier',
          label: 'Loyalty / VIP Tier',
          type: 'SELECT',
          required: false,
          options: ['Standard', 'Silver', 'Gold', 'Platinum'],
          entityType: 'CUSTOMER',
        },
      ]
    );
  }

  async validateDynamicFields(
    tenantId: string,
    entityType: string,
    values: Record<string, any>
  ): Promise<{ valid: boolean; errors?: string[] }> {
    const definitions = await this.getCustomFields(tenantId, entityType);
    const errors: string[] = [];

    for (const def of definitions) {
      const val = values[def.name];

      // Check required
      if (def.required && (val === undefined || val === null || val === '')) {
        errors.push(`Custom field '${def.label}' is required`);
        continue;
      }

      if (val !== undefined && val !== null) {
        // Check types
        if (def.type === 'NUMBER' && isNaN(Number(val))) {
          errors.push(`Custom field '${def.label}' must be a valid number`);
        } else if (def.type === 'SELECT' && def.options && !def.options.includes(val)) {
          errors.push(`Custom field '${def.label}' value '${val}' is not one of: ${def.options.join(', ')}`);
        }
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException({ message: 'Validation failed for custom fields', errors });
    }

    return { valid: true };
  }

  async getPipelines(tenantId: string) {
    return [
      {
        id: 'pipe_lead_default',
        tenantId,
        name: 'Standard Lead Pipeline',
        targetEntity: 'LEAD',
        stages: [
          { key: 'NEW', name: 'New Lead', color: 'blue' },
          { key: 'CONTACTED', name: 'Contacted', color: 'indigo' },
          { key: 'PROPOSAL_SENT', name: 'Quoted', color: 'amber' },
          { key: 'CONVERTED', name: 'Won', color: 'green' },
          { key: 'LOST', name: 'Lost', color: 'rose' },
        ],
      },
    ];
  }
}
