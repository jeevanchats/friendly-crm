import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { WorkflowService } from './workflow.service';
import {
  AuthGuard,
  TenantGuard,
  PermissionsGuard,
  RequirePermission,
  CurrentTenant,
} from '../../common';

@Controller('workflow')
@UseGuards(AuthGuard, TenantGuard, PermissionsGuard)
export class WorkflowController {
  constructor(private readonly workflowService: WorkflowService) {}

  @Get('custom-fields')
  @RequirePermission('workflow:read')
  async getCustomFields(
    @CurrentTenant() tenant: { id: string },
    @Query('entityType') entityType: string
  ) {
    return this.workflowService.getCustomFields(tenant.id, entityType);
  }

  @Post('validate-fields')
  @RequirePermission('workflow:read')
  async validateFields(
    @CurrentTenant() tenant: { id: string },
    @Body() body: { entityType: string; values: Record<string, any> }
  ) {
    return this.workflowService.validateDynamicFields(tenant.id, body.entityType, body.values);
  }

  @Get('pipelines')
  @RequirePermission('workflow:read')
  async getPipelines(@CurrentTenant() tenant: { id: string }) {
    return this.workflowService.getPipelines(tenant.id);
  }
}
