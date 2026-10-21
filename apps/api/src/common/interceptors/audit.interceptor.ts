import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request } from 'express';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const { method, url, tenant, user, body } = request;

    // Only audit mutating actions
    const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: (responseBody) => {
          if (isMutation && tenant?.id) {
            // Log mutation for audit trail
            console.log(`[AUDIT] Tenant: ${tenant.id} | User: ${user?.id ?? 'ANON'} | ${method} ${url} | Duration: ${Date.now() - startTime}ms`, {
              payload: body,
              resultId: responseBody?.id,
            });
            // Here you would insert into auditLogs table using @friendly-crm/db
          }
        },
        error: (err) => {
          if (isMutation && tenant?.id) {
            console.warn(`[AUDIT-FAILED] Tenant: ${tenant.id} | User: ${user?.id ?? 'ANON'} | ${method} ${url} | Error: ${err.message}`);
          }
        },
      }),
    );
  }
}
