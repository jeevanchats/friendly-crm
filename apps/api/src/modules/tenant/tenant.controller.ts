import { Controller, Post, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { TenantService, CreateTenantDto } from './tenant.service';
import {
  AuthGuard,
  TenantGuard,
  PermissionsGuard,
  RequirePermission,
  CurrentTenant,
  CurrentUser,
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

  @Get('settings')
  @UseGuards(AuthGuard, TenantGuard, PermissionsGuard)
  @RequirePermission('tenant:read')
  async getSettings(@CurrentTenant() tenant: { id: string }) {
    return this.tenantService.getSettings(tenant.id);
  }

  /** Owner-only. The change is audited inside TenantService.updateSettings. */
  @Patch('settings')
  @UseGuards(AuthGuard, TenantGuard, PermissionsGuard)
  @RequirePermission('settings:manage')
  async updateSettings(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string } | undefined,
    @Body() body: { customerSelfServiceEnabled?: boolean }
  ) {
    return this.tenantService.updateSettings(
      tenant.id,
      user?.id ?? null,
      { customerSelfServiceEnabled: body?.customerSelfServiceEnabled },
      'API'
    );
  }
}
