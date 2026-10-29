import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

export interface ISmsGateway {
  sendOtp(phone: string, otp: string): Promise<boolean>;
}

@Injectable()
export class DevSmsGateway implements ISmsGateway {
  private static readonly otpStore = new Map<string, string>();

  async sendOtp(phone: string, otp: string): Promise<boolean> {
    const isTest = process.env.NODE_ENV === 'test';
    const isDevEnabled = process.env.ENABLE_DEV_SMS_GATEWAY === 'true';

    if (!isTest && !isDevEnabled) {
      throw new ServiceUnavailableException(
        'Development SMS gateway is disabled. Enable ENABLE_DEV_SMS_GATEWAY=true or set FAST2SMS_API_KEY.'
      );
    }

    // Securely hold in test-inspectable store without printing sensitive OTP in production logs
    DevSmsGateway.otpStore.set(phone, otp);

    // Local development only: show the code in the API console so a developer can log in
    // without an SMS provider. Never prints in production or tests.
    if (isDevEnabled && process.env.NODE_ENV !== 'production' && !isTest) {
      new Logger('DevSmsGateway').warn(`DEV OTP for ${phone}: ${otp}`);
    }
    return true;
  }

  static getLatestOtp(phone: string): string | undefined {
    return DevSmsGateway.otpStore.get(phone);
  }

  static clear(): void {
    DevSmsGateway.otpStore.clear();
  }
}
