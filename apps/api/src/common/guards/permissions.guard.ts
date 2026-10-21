import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionAction, TenantRole, hasPermission } from '@friendly-crm/shared';

export const PERMISSIONS_KEY = 'permissions';
export const RequirePermission = (...permissions: PermissionAction[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<PermissionAction[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()]
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const role: TenantRole = (request.user?.role ||
      request.headers['x-user-role'] ||
      request.headers['x-role'] ||
      'OWNER') as TenantRole;

    const hasAll = requiredPermissions.every((perm) => hasPermission(role, perm));
    if (!hasAll) {
      throw new ForbiddenException(
        `Role '${role}' lacks required permissions: [${requiredPermissions.join(', ')}]`
      );
    }

    return true;
  }
}
