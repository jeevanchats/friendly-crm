import { Injectable, Logger } from '@nestjs/common';
import { INotificationAdapter } from './notification-adapter.interface';
import { DevNotificationAdapter } from './dev-notification.adapter';
import { HttpWhatsAppAdapter } from './http-whatsapp.adapter';
import { TwilioWhatsAppAdapter } from './twilio-whatsapp.adapter';

export interface TenantWhatsAppConfig {
  apiUrl: string;
  apiKey?: string;
  phoneNumberId?: string;
}

@Injectable()
export class TenantNotificationProviderManager {
  private readonly logger = new Logger(TenantNotificationProviderManager.name);
  private tenantConfigs = new Map<string, TenantWhatsAppConfig>();
  private adapters = new Map<string, INotificationAdapter>();
  private devAdapter = new DevNotificationAdapter();
  private twilioAdapter = new TwilioWhatsAppAdapter();

  /**
   * Register custom credentials for a specific tenant
   */
  registerTenantConfig(tenantId: string, config: TenantWhatsAppConfig) {
    this.tenantConfigs.set(tenantId, config);
    // Invalidate cached adapter
    this.adapters.delete(tenantId);
    this.logger.log(`Configured custom WhatsApp credentials for tenant ${tenantId}`);
  }

  /**
   * Resolve notification adapter for a given tenant
   */
  getAdapterForTenant(tenantId: string): INotificationAdapter {
    const isTest = process.env.NODE_ENV === 'test';
    const isDevGateway = process.env.ENABLE_DEV_SMS_GATEWAY === 'true';

    if (isTest || isDevGateway) {
      return this.devAdapter;
    }

    // Check cached adapter
    if (this.adapters.has(tenantId)) {
      return this.adapters.get(tenantId)!;
    }

    // Check tenant-specific config
    const customConfig = this.tenantConfigs.get(tenantId);
    if (customConfig && customConfig.apiUrl) {
      const adapter = new HttpWhatsAppAdapter();
      adapter.overrideUrl = customConfig.apiUrl;
      adapter.overrideKey = customConfig.apiKey;
      this.adapters.set(tenantId, adapter);
      return adapter;
    }

    // Check environment-level fallback for tenant
    const envUrl = process.env[`WHATSAPP_TENANT_${tenantId.toUpperCase().replace(/-/g, '_')}_URL`];
    if (envUrl) {
      const adapter = new HttpWhatsAppAdapter();
      adapter.overrideUrl = envUrl;
      this.adapters.set(tenantId, adapter);
      return adapter;
    }

    // Twilio, when its account, token and sender are set
    if (TwilioWhatsAppAdapter.isConfigured()) return this.twilioAdapter;

    // Default global hostinger URL if set
    const defaultUrl = process.env.HOSTINGER_WHATSAPP_API_URL;
    if (defaultUrl) {
      const adapter = new HttpWhatsAppAdapter();
      adapter.overrideUrl = defaultUrl;
      this.adapters.set(tenantId, adapter);
      return adapter;
    }

    return this.devAdapter;
  }
}
