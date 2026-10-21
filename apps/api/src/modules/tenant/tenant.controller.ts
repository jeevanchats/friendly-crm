import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { TenantService, CreateTenantDto } from './tenant.service';
import { TenantGuard, RbacGuard, Roles, CurrentTenant } from '../../common';
import { Role } from '@friendly-crm/shared';

@Controller('tenants')
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  @Post('onboard')
  async onboard(@Body() dto: CreateTenantDto) {
    return this.tenantService.onboardTenant(dto);
  }

  @Get('current')
  @UseGuards(TenantGuard, RbacGuard)
  @Roles(Role.OWNER, Role.ADMIN, Role.SALES_MANAGER, Role.SALES_REP, Role.VIEWER)
  async getCurrentTenant(@CurrentTenant() tenant: { id: string }) {
    return this.tenantService.getTenantDetails(tenant.id);
  }
}
