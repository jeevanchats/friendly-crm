import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard, TenantGuard, PermissionsGuard, RequirePermission, CurrentTenant, CurrentUser } from '../../common';
import { TenantRole } from '@friendly-crm/shared';
import { TeamService } from './team.service';

/** Owner-only (settings:manage). Every change is audited inside TeamService. */
@Controller('team')
@UseGuards(AuthGuard, TenantGuard, PermissionsGuard)
@RequirePermission('settings:manage')
export class TeamController {
  constructor(private readonly team: TeamService) {}

  @Get()
  list(@CurrentTenant() tenant: { id: string }) {
    return this.team.list(tenant.id);
  }

  @Post()
  add(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string },
    @Body() body: { fullName: string; phone: string; role: TenantRole }
  ) {
    return this.team.add(tenant.id, user.id, body ?? ({} as any));
  }

  @Patch(':userId')
  update(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string },
    @Param('userId') userId: string,
    @Body() body: { role?: TenantRole; isActive?: boolean }
  ) {
    return this.team.update(tenant.id, user.id, userId, body ?? {});
  }
}
