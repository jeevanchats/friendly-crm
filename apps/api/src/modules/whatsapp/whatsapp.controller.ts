import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import { CrmService } from '../crm/crm.service';

@Controller('webhook/whatsapp')
export class WhatsAppWebhookController {
  constructor(private readonly crmService: CrmService) {}

  @Post()
  @HttpCode(200)
  async handleIncomingMessage(@Body() payload: any) {
    // WAHA / Evolution API webhook payload structure
    if (payload.event === 'message' && !payload.payload.fromMe) {
      const senderPhone = payload.payload.from; // e.g., '919876543210@c.us'
      const messageBody = payload.payload.body;
      const customerName = payload.payload._data?.notifyName || 'WhatsApp Lead';

      // Automatically create a Lead in Friendly CRM from incoming WhatsApp text!
      const rawPhone = `+${senderPhone.split('@')[0]}`;
      
      // Assumes default tenant ID for single-instance or multi-tenant lookup
      // (Can be mapped dynamically if multi-tenant numbers are used)
      await this.crmService.intakeLead(
        process.env.DEFAULT_TENANT_ID!,
        process.env.DEFAULT_SYSTEM_USER_ID!,
        'printing', // Default or detected industry template
        {
          phone: rawPhone,
          customerName,
          title: `Inbound WA: "${messageBody.slice(0, 50)}..."`,
          source: 'WHATSAPP',
          notes: messageBody,
          customData: {},
        }
      );
    }
    return { status: 'received' };
  }
}