import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { WorkflowService } from './workflow.service';
import { TenantGuard, RbacGuard, Roles, CurrentTenant } from '../../common';
import { Role } from '@friendly-crm/shared';

@Controller('workflow')
@UseGuards(TenantGuard, RbacGuard)
export class WorkflowController {
  constructor(private readonly workflowService: WorkflowService) {}

  @Get('custom-fields')
  @Roles(Role.OWNER, Role.ADMIN, Role.SALES_MANAGER, Role.SALES_REP, Role.VIEWER)
  async getCustomFields(
    @CurrentTenant() tenant: { id: string },
    @Query('entityType') entityType: string
  ) {
    return this.workflowService.getCustomFields(tenant.id, entityType);
  }

  @Post('validate-fields')
  @Roles(Role.OWNER, Role.ADMIN, Role.SALES_MANAGER, Role.SALES_REP)
  async validateFields(
    @CurrentTenant() tenant: { id: string },
    @Body() body: { entityType: string; values: Record<string, any> }
  ) {
    return this.workflowService.validateDynamicFields(tenant.id, body.entityType, body.values);
  }

  @Get('pipelines')
  @Roles(Role.OWNER, Role.ADMIN, Role.SALES_MANAGER, Role.SALES_REP, Role.VIEWER)
  async getPipelines(@CurrentTenant() tenant: { id: string }) {
    return this.workflowService.getPipelines(tenant.id);
  }
}
