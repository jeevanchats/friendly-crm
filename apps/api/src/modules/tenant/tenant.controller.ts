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
    @Body()
    body: {
      customerSelfServiceEnabled?: boolean;
      upiId?: string | null;
      bankAccountName?: string | null;
      bankName?: string | null;
      bankAccountNumber?: string | null;
      bankIfsc?: string | null;
      bankBranch?: string | null;
      gstNumber?: string | null;
      legalName?: string | null;
      address?: string | null;
      stateCode?: string | null;
      autoRemindersEnabled?: boolean;
      reminderAfterDays?: number;
      reminderRepeatDays?: number;
      reminderMaxCount?: number;
    }
  ) {
    return this.tenantService.updateSettings(
      tenant.id,
      user?.id ?? null,
      {
        customerSelfServiceEnabled: body?.customerSelfServiceEnabled,
        upiId: body?.upiId,
        bankAccountName: body?.bankAccountName,
        bankName: body?.bankName,
        bankAccountNumber: body?.bankAccountNumber,
        bankIfsc: body?.bankIfsc,
        bankBranch: body?.bankBranch,
        gstNumber: body?.gstNumber,
        legalName: body?.legalName,
        address: body?.address,
        stateCode: body?.stateCode,
        autoRemindersEnabled: body?.autoRemindersEnabled,
        reminderAfterDays: body?.reminderAfterDays,
        reminderRepeatDays: body?.reminderRepeatDays,
        reminderMaxCount: body?.reminderMaxCount,
      },
      'API'
    );
  }
}
