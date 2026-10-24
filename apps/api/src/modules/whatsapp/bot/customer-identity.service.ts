import { Injectable, Logger } from '@nestjs/common';
import { db, sql } from '@friendly-crm/db';
import { globalMemoryCustomers, globalMemoryTenants } from '../../crm/memory-store';
import { CustomerIdentity } from './conversation.engine';

/**
 * Resolves "which customer record(s) does this WhatsApp number belong to?" across tenants,
 * using the SECURITY DEFINER function lookup_customer_by_phone (migration 0004).
 * The in-memory fallback is used ONLY if the database is unreachable.
 */
@Injectable()
export class CustomerIdentityService {
  private readonly logger = new Logger(CustomerIdentityService.name);

  async findByPhone(phoneE164: string): Promise<CustomerIdentity[]> {
    if (process.env.ENABLE_CUSTOMER_SELF_SERVICE === 'false') return [];

    try {
      if (db && typeof db.execute === 'function') {
        const result: any = await db.execute(sql`SELECT * FROM lookup_customer_by_phone(${phoneE164})`);
        const rows: any[] = Array.isArray(result) ? result : result?.rows ?? [];
        return rows.map((r) => ({
          customerId: r.customer_id,
          customerName: r.customer_name,
          tenantId: r.tenant_id,
          tenantName: r.tenant_name,
          tenantPhone: r.tenant_phone,
          industryKey: r.industry_key,
          defaultLanguage: r.default_language || 'en',
          selfServiceEnabled: r.self_service_enabled !== false,
        }));
      }
    } catch (err: any) {
      this.logger.warn(`Postgres offline; customer phone lookup using memory store: ${err.message}`);
    }

    return globalMemoryCustomers
      .filter((c) => c.phone === phoneE164 || c.whatsappNumber === phoneE164)
      .map((c) => {
        const tenant: any = globalMemoryTenants.get(c.tenantId);
        return {
          customerId: c.id,
          customerName: c.name,
          tenantId: c.tenantId,
          tenantName: tenant?.name ?? 'Business',
          tenantPhone: tenant?.phone ?? null,
          industryKey: tenant?.industryKey ?? 'printing',
          defaultLanguage: tenant?.defaultLanguage ?? 'en',
          selfServiceEnabled: tenant?.customerSelfServiceEnabled !== false,
        };
      });
  }
}
