import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { TenantService, CreateTenantDto } from './tenant.service';
import {
  AuthGuard,
  TenantGuard,
  PermissionsGuard,
  RequirePermission,
  CurrentTenant,
} from '../../common';

@Controller(['tenants', 'tenant'])
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  @Post('onboard')
  async onboard(@Body() dto: CreateTenantDto) {
    return this.tenantService.onboardTenant(dto);
  }

  @Get(['current', 'details'])
  @UseGuards(AuthGuard, TenantGuard, PermissionsGuard)
  @RequirePermission('tenant:read')
  async getCurrentTenant(@CurrentTenant() tenant: { id: string }) {
    return this.tenantService.getTenantDetails(tenant.id);
  }
}
