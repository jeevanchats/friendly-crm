import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService, UserTenantMembership } from '../../modules/auth/auth.service';
import { TenantRole } from '@friendly-crm/shared';

export interface TenantContext {
  id: string;
  name?: string;
  industryKey?: string;
  slug?: string;
}

export interface AssignmentScope {
  userId: string;
  restricted: boolean;
}

declare global {
  namespace Express {
    interface Request {
      tenant?: TenantContext;
      membership?: UserTenantMembership;
      assignmentScope?: AssignmentScope;
      user?: {
        id: string;
        phone: string;
        role: TenantRole | string;
        fullName?: string;
        email?: string;
      };
    }
  }
}

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    // 1. Require authenticated user context
    if (!request.user || !request.user.id) {
      throw new UnauthorizedException('Authentication required before tenant resolution');
    }

    // 2. Extract requested tenant ID from header or query
    const requestedTenantId =
      (request.headers['x-tenant-id'] as string) ||
      (request.headers['x-tenant'] as string) ||
      (request.query['tenantId'] as string);

    if (!requestedTenantId) {
      // Check if user has an active membership we can resolve
      const allMemberships = await this.authService.getUserMemberships(request.user.id);
      const active = allMemberships.find((m) => m.isActive);
      if (!active) {
        throw new BadRequestException('Tenant context required: pass X-Tenant-Id header');
      }
      return this.applyTenantContext(request, active);
    }

    // 3. Verify membership in the requested tenant (never trust caller headers for role)
    const membership = await this.authService.getUserTenantMembership(
      request.user.id,
      requestedTenantId
    );

    if (!membership || !membership.isActive) {
      throw new ForbiddenException(
        'Access denied: You are not an active member of the requested tenant'
      );
    }

    return this.applyTenantContext(request, membership);
  }

  private applyTenantContext(request: Request, membership: UserTenantMembership): boolean {
    request.tenant = {
      id: membership.tenantId,
      name: membership.tenantName,
      industryKey: membership.industryKey,
    };

    // Role is derived STRICTLY from server-side membership, completely ignoring any x-user-role header
    request.user!.role = membership.role;
    request.membership = membership;

    // Assignment-based scoping for Salesperson and Production
    if (membership.role === 'SALESPERSON') {
      request.assignmentScope = {
        userId: request.user!.id,
        restricted: true,
      };
    }

    return true;
  }
}
