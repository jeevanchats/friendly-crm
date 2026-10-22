import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request } from 'express';
import { db, auditLogs } from '@friendly-crm/db';
import { randomUUID } from 'crypto';
import { globalMemoryAuditLogs } from '../../modules/crm/memory-store';

const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /token/i,
  /secret/i,
  /code/i,
  /otp/i,
  /authorization/i,
  /cookie/i,
  /credit[-_]?card/i,
  /cvv/i,
];

function sanitizeForAudit(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeForAudit(item));
  }

  const sanitized: Record<string, any> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof val === 'object' && val !== null) {
      sanitized[key] = sanitizeForAudit(val);
    } else {
      sanitized[key] = val;
    }
  }
  return sanitized;
}

function resolveEntityAndAction(method: string, url: string): { entityType: string; action: string } {
  const cleanUrl = url.split('?')[0];

  if (cleanUrl.includes('/api/crm/intake-lead')) return { entityType: 'LEAD', action: 'LEAD_INTAKE' };
  if (cleanUrl.includes('/api/crm/leads') && cleanUrl.includes('/stage')) return { entityType: 'LEAD', action: 'STAGE_CHANGED' };
  if (cleanUrl.includes('/api/crm/tasks') && cleanUrl.includes('/complete')) return { entityType: 'TASK', action: 'TASK_COMPLETED' };
  if (cleanUrl.includes('/api/crm/tasks')) return { entityType: 'TASK', action: 'TASK_CREATED' };
  if (cleanUrl.includes('/api/sales/quotations') && cleanUrl.includes('/revisions')) return { entityType: 'QUOTATION', action: 'REVISION' };
  if (cleanUrl.includes('/api/sales/quotations') && cleanUrl.includes('/convert')) return { entityType: 'ORDER', action: 'QUOTE_CONVERTED_TO_ORDER' };
  if (cleanUrl.includes('/api/sales/quotations')) return { entityType: 'QUOTATION', action: 'CREATE' };
  if (cleanUrl.includes('/api/orders') && cleanUrl.includes('/stage')) return { entityType: 'ORDER', action: 'STAGE_UPDATED' };
  if (cleanUrl.includes('/api/orders') && cleanUrl.includes('/payments')) return { entityType: 'PAYMENT', action: 'PAYMENT_RECORDED' };
  if (cleanUrl.includes('/api/tenant') && cleanUrl.includes('/onboard')) return { entityType: 'TENANT', action: 'ONBOARDED' };

  const segments = cleanUrl.replace(/^\/api\//, '').split('/');
  const rawEntity = (segments[1] || segments[0] || 'RESOURCE').toUpperCase();
  const entityType = rawEntity.endsWith('S') ? rawEntity.slice(0, -1) : rawEntity;
  const action =
    method === 'POST' ? 'CREATE' : method === 'PATCH' || method === 'PUT' ? 'UPDATE' : method === 'DELETE' ? 'DELETE' : 'MUTATION';

  return { entityType, action };
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const { method, url, tenant, user, body, ip, headers } = request;

    // Only audit mutating actions
    const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: async (responseBody) => {
          if (isMutation && tenant?.id) {
            const { entityType, action } = resolveEntityAndAction(method, url);
            const sanitizedBody = sanitizeForAudit(body);
            const entityId =
              responseBody?.id ||
              responseBody?.orderId ||
              responseBody?.leadId ||
              responseBody?.taskId ||
              responseBody?.customer?.id ||
              null;

            const auditRecord = {
              id: randomUUID(),
              tenantId: tenant.id,
              actorId: user?.id || null,
              action,
              entityType,
              entityId: entityId ? String(entityId) : null,
              changes: {
                after: sanitizedBody,
                metadata: {
                  url,
                  method,
                  durationMs: Date.now() - startTime,
                  resultId: responseBody?.id || responseBody?.orderId,
                },
              },
              ipAddress: ((ip || headers['x-forwarded-for']) as string || '').slice(0, 50),
              userAgent: ((headers['user-agent'] as string) || '').slice(0, 255),
              createdAt: new Date(),
            };

            // 1. Try DB persistent audit log insertion
            try {
              if (db && typeof db.insert === 'function') {
                await db.insert(auditLogs).values(auditRecord);
              }
            } catch (err: any) {
              this.logger.warn(`Postgres offline; persisting audit to memory store: ${err.message}`);
            }

            // 2. Mirror to unified in-memory store
            globalMemoryAuditLogs.unshift(auditRecord);

            this.logger.log(
              `[AUDIT] Tenant: ${tenant.id} | User: ${user?.id ?? 'ANON'} | ${action} ${entityType} | Duration: ${Date.now() - startTime}ms`
            );
          }
        },
        error: (err) => {
          if (isMutation && tenant?.id) {
            this.logger.warn(
              `[AUDIT-FAILED] Tenant: ${tenant.id} | User: ${user?.id ?? 'ANON'} | ${method} ${url} | Error: ${err.message}`
            );
          }
        },
      }),
    );
  }
}

