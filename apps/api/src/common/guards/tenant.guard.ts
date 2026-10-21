import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';

export interface TenantContext {
  id: string;
  slug?: string;
}

declare global {
  namespace Express {
    interface Request {
      tenant?: TenantContext;
      user?: {
        id: string;
        phone: string;
        role: string;
      };
    }
  }
}

@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    // Extract tenant ID from header or query or fallback to demo printing tenant
    const tenantIdHeader =
      (request.headers['x-tenant-id'] as string) ||
      (request.headers['x-tenant'] as string) ||
      (request.query['tenantId'] as string) ||
      't-demo-printing';

    // Set tenant context for this request lifecycle
    request.tenant = {
      id: tenantIdHeader,
    };

    if (!request.user) {
      const userRole =
        (request.headers['x-user-role'] as string) ||
        (request.headers['x-role'] as string) ||
        'OWNER';

      request.user = {
        id: (request.headers['x-user-id'] as string) || 'u-demo-1',
        phone: (request.headers['x-user-phone'] as string) || '+919840000000',
        role: userRole,
      };
    }

    return true;
  }
}
