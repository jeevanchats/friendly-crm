import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@friendly-crm/shared';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user || !user.role) {
      throw new ForbiddenException('User context missing or unauthenticated');
    }

    const userRole = user.role as Role;
    const hasRole = requiredRoles.includes(userRole);
    if (!hasRole) {
      throw new ForbiddenException(`Insufficient permissions: Requires role [${requiredRoles.join(', ')}]`);
    }

    return true;
  }
}
