import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  Logger,
} from '@nestjs/common';
import { Observable, from, throwError } from 'rxjs';
import { AsyncLocalStorage } from 'async_hooks';
import { db, sql } from '@friendly-crm/db';

export interface TenantSessionContext {
  tenantId: string;
  tx?: any;
}

// Global AsyncLocalStorage to propagate tenant session context across asynchronous boundaries
export const tenantContextStorage = new AsyncLocalStorage<TenantSessionContext>();

@Injectable()
export class TenantRlsInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TenantRlsInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();

    // 1. Read tenantId from the user session, authenticated user payload, or custom tenant headers
    const tenantId: string | undefined =
      request.session?.tenantId ||
      request.user?.tenantId ||
      request.tenant?.id ||
      (request.headers['x-tenant-id'] as string) ||
      (request.headers['x-tenant'] as string);

    if (!tenantId) {
      // For unauthenticated or public routes (e.g., /health, initial OTP requests), proceed normally
      return next.handle();
    }

    // Attach tenantId to request context
    request.tenantId = tenantId;
    if (!request.tenant) {
      request.tenant = { id: tenantId };
    }

    // 2. Wrap execution within a Drizzle database transaction that executes:
    //    SET LOCAL app.current_tenant_id = '<tenantId>'
    return from(
      this.executeWithTenantRls(tenantId, request, next)
    );
  }

  private async executeWithTenantRls(
    tenantId: string,
    request: any,
    next: CallHandler
  ): Promise<any> {
    try {
      return await db.transaction(async (tx) => {
        // Enforce PostgreSQL Row-Level Security for this specific transaction
        await tx.execute(
          sql.raw(`SET LOCAL app.current_tenant_id = '${tenantId.replace(/'/g, "''")}'`)
        );
        this.logger.debug(`[RLS Activated] SET LOCAL app.current_tenant_id = '${tenantId}'`);

        // Expose the active transaction directly on the request object
        request.dbTx = tx;

        // Run the downstream controller/service handlers within AsyncLocalStorage
        return await tenantContextStorage.run({ tenantId, tx }, async () => {
          // Convert RxJS Observable from next.handle() into a Promise within the transaction
          const result$ = next.handle();
          const { firstValueFrom } = await import('rxjs');
          return await firstValueFrom(result$);
        });
      });
    } catch (err: any) {
      // In case Postgres database is not reachable in local dev offline mode,
      // allow fallback with simulated context while logging warning
      if (err?.code === 'ECONNREFUSED' || err?.message?.includes('connect ECONNREFUSED')) {
        this.logger.warn(
          `PostgreSQL offline; proceeding with fallback tenant context for '${tenantId}'`
        );
        return await tenantContextStorage.run({ tenantId }, async () => {
          const { firstValueFrom } = await import('rxjs');
          return await firstValueFrom(next.handle());
        });
      }

      this.logger.error(`RLS Transaction aborted for tenant '${tenantId}': ${err.message}`, err.stack);
      throw err;
    }
  }
}
