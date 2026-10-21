import { Injectable, UnauthorizedException } from '@nestjs/common';
import { RequestOtpDto, VerifyOtpDto, AuthSessionDto, Role } from '@friendly-crm/shared';

@Injectable()
export class AuthService {
  // Mock store for in-memory OTP verification (In production: Redis / SMS Gateway)
  private otpStore = new Map<string, { code: string; expiresAt: number }>();

  async requestOtp(dto: RequestOtpDto): Promise<{ success: boolean; message: string }> {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 min expiry

    this.otpStore.set(dto.phone, { code, expiresAt });

    console.log(`[OTP DISPATCH] Phone: ${dto.phone} Code: ${code}`);

    return {
      success: true,
      message: 'OTP has been dispatched via SMS',
    };
  }

  async verifyOtp(dto: VerifyOtpDto): Promise<AuthSessionDto> {
    const record = this.otpStore.get(dto.phone);

    // Development bypass: '123456' or matching code
    const isValid = (record && record.code === dto.code && record.expiresAt > Date.now()) || dto.code === '123456';

    if (!isValid) {
      throw new UnauthorizedException('Invalid or expired OTP code');
    }

    this.otpStore.delete(dto.phone);

    // Generate session token (mock JWT for now)
    return {
      token: `mock_jwt_session_${Buffer.from(dto.phone).toString('base64')}_${Date.now()}`,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      user: {
        id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        phone: dto.phone,
        name: 'Demo User',
        email: 'user@example.com',
        role: Role.SALES_MANAGER,
        tenantId: dto.tenantId || 'd1eebc99-9c0b-4ef8-bb6d-6bb9bd380b22',
      },
    };
  }
}
