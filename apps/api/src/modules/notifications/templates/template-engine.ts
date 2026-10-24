import { Injectable } from '@nestjs/common';

export interface TemplateContext {
  [key: string]: any;
}

export interface NotificationTemplate {
  key: string;
  en: string;
  ta: string;
  defaultParams?: Record<string, string>;
}

export const BUILTIN_TEMPLATES: Record<string, NotificationTemplate> = {
  QUOTATION_CREATED: {
    key: 'QUOTATION_CREATED',
    en: 'Hello {{customerName || "Customer"}},\nHere is your quotation from our team:\n*Quote No:* {{quoteNumber}} (v{{version || 1}})\n*Total Amount:* ₹{{grandTotal || "—"}}\n\nDownload PDF: {{pdfUrl || "—"}}\n\nTo approve this quote or ask for a change, reply *quotes* on this chat.',
    ta: 'வணக்கம் {{customerName || "வாடிக்கையாளர்"}},\nஎங்கள் குழுவின் கொட்டேஷன் இதோ:\n*எண்:* {{quoteNumber}} (v{{version || 1}})\n*மொத்த மதிப்பு:* ₹{{grandTotal || "—"}}\n\nPDF பதிவிறக்க: {{pdfUrl || "—"}}\n\nஇந்த கொட்டேஷனை ஒப்புக்கொள்ள அல்லது மாற்றம் கேட்க, இந்த சாட்டில் *quotes* என பதிலளிக்கவும்.',
  },
  ORDER_CONFIRMED: {
    key: 'ORDER_CONFIRMED',
    en: 'Hello {{customerName || "Customer"}},\nYour Order *{{orderNumber}}* has been confirmed!\n*Stage:* {{stageName || "Order Confirmed"}}\n*Expected Delivery:* {{expectedDelivery || "To be scheduled"}}',
    ta: 'வணக்கம் {{customerName || "வாடிக்கையாளர்"}},\nஉங்கள் ஆர்டர் *{{orderNumber}}* உறுதி செய்யப்பட்டது!\n*நிலை:* {{stageName || "ஆர்டர் உறுதி"}}\n*எதிர்பார்க்கப்படும் விநியோகம்:* {{expectedDelivery || "திட்டமிடப்படும்"}}',
  },
  STAGE_UPDATED: {
    key: 'STAGE_UPDATED',
    en: 'Hello {{customerName || "Customer"}},\nYour Order *{{orderNumber}}* status is now: *{{stageName}}*.{{balanceText}}',
    ta: 'வணக்கம் {{customerName || "வாடிக்கையாளர்"}},\nஉங்கள் ஆர்டர் *{{orderNumber}}* தற்போதைய நிலை: *{{stageName}}*.{{balanceText}}',
  },
  PAYMENT_RECEIPT: {
    key: 'PAYMENT_RECEIPT',
    en: 'Hello {{customerName || "Customer"}},\nWe have received your payment of ₹{{amount}} via {{mode || "UPI"}}.\n*Receipt No:* {{receiptNumber}}\n*Balance Remaining:* ₹{{balanceRemaining || "0.00"}}',
    ta: 'வணக்கம் {{customerName || "வாடிக்கையாளர்"}},\nஉங்கள் ₹{{amount}} கட்டணம் {{mode || "UPI"}} மூலம் பெறப்பட்டது.\n*ரசீது எண்:* {{receiptNumber}}\n*பாக்கித் தொகை:* ₹{{balanceRemaining || "0.00"}}',
  },
};

@Injectable()
export class TemplateEngine {
  /**
   * Sanitizes input strings to strip dangerous injection control characters.
   */
  public escapeParam(value: any): string {
    if (value === null || value === undefined) return '';
    const str = String(value);
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Safe string formatter that replaces {{variable}} or {{variable || fallback}}.
   * Does NOT leave undefined/null in rendered output.
   */
  public render(templateString: string, context: TemplateContext = {}): string {
    if (!templateString) return '';

    // Regex to match {{key}} or {{key || "fallback"}} or {{key || fallback}}
    return templateString.replace(/\{\{\s*([a-zA-Z0-9_]+)(?:\s*\|\|\s*(?:"([^"]*)"|'([^']*)'|([^}]+)))?\s*\}\}/g, (match, key, dQuoted, sQuoted, rawFallback) => {
      const fallback = (dQuoted !== undefined ? dQuoted : sQuoted !== undefined ? sQuoted : rawFallback || '').trim();
      const val = context[key];

      if (val !== undefined && val !== null && String(val).trim() !== '') {
        return String(val);
      }

      return fallback;
    });
  }

  /**
   * Renders a named notification template for a specific language (en or ta).
   */
  public renderTemplate(
    templateKey: string,
    lang: 'en' | 'ta' = 'en',
    context: TemplateContext = {}
  ): string {
    const tpl = BUILTIN_TEMPLATES[templateKey];
    if (!tpl) {
      // Fallback for custom or raw template string
      return this.render(templateKey, context);
    }

    const templateText = lang === 'ta' ? tpl.ta : tpl.en;
    return this.render(templateText, context);
  }
}
