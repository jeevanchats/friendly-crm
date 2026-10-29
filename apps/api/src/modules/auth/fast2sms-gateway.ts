import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import type { ISmsGateway } from './sms-gateway';

const ENDPOINT = 'https://www.fast2sms.com/dev/bulkV2';
const TIMEOUT_MS = 10_000;

/**
 * Sends sign-in codes through Fast2SMS. Used when FAST2SMS_API_KEY is set (and never in tests).
 *
 * FAST2SMS_ROUTE=otp (default): Fast2SMS's own OTP route, needs no DLT template.
 * FAST2SMS_ROUTE=dlt: your DLT-approved template; also set FAST2SMS_SENDER_ID and FAST2SMS_TEMPLATE_ID
 *   (the template's variable must be the code).
 */
@Injectable()
export class Fast2SmsGateway implements ISmsGateway {
  private readonly logger = new Logger('Fast2SmsGateway');

  static isConfigured(): boolean {
    return !!process.env.FAST2SMS_API_KEY && process.env.NODE_ENV !== 'test';
  }

  async sendOtp(phone: string, otp: string): Promise<boolean> {
    const route = process.env.FAST2SMS_ROUTE === 'dlt' ? 'dlt' : 'otp';
    // Fast2SMS takes the 10-digit Indian number without +91.
    const number = phone.replace(/^\+?91/, '');

    const body: Record<string, string> = { route, numbers: number, variables_values: otp };
    if (route === 'dlt') {
      body.sender_id = process.env.FAST2SMS_SENDER_ID ?? '';
      body.message = process.env.FAST2SMS_TEMPLATE_ID ?? '';
    }

    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { authorization: process.env.FAST2SMS_API_KEY!, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err: any) {
      this.logger.error(`Fast2SMS unreachable: ${err.message}`);
      throw new BadGatewayException('Could not send the sign-in code. Please try again.');
    }

    const result: any = await res.json().catch(() => ({}));
    if (!res.ok || result.return !== true) {
      // Log the provider's reason (e.g. low balance, bad key) but never the code or the full number.
      const reason = Array.isArray(result.message) ? result.message.join(' ') : result.message;
      this.logger.error(`Fast2SMS refused the message (HTTP ${res.status}, code ${result.status_code}): ${reason}`);
      throw new BadGatewayException('Could not send the sign-in code. Please try again.');
    }
    return true;
  }
}
