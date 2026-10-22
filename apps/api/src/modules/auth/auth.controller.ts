import {
  Controller,
  Post,
  Get,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  RequestOtpSchema,
  VerifyOtpSchema,
  RequestOtpDto,
  VerifyOtpDto,
  AuthSessionDto,
} from '@friendly-crm/shared';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  async requestOtp(@Body() rawBody: unknown) {
    const parsed = RequestOtpSchema.safeParse(rawBody);
    if (!parsed.success) {
      const errorMsg = parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
      throw new BadRequestException({ statusCode: 400, message: errorMsg });
    }
    return this.authService.requestOtp(parsed.data);
  }

  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  async verifyOtp(@Body() rawBody: unknown): Promise<AuthSessionDto> {
    const parsed = VerifyOtpSchema.safeParse(rawBody);
    if (!parsed.success) {
      const errorMsg = parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
      throw new BadRequestException({ statusCode: 400, message: errorMsg });
    }
    return this.authService.verifyOtp(parsed.data);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Headers('authorization') authHeader?: string) {
    const token = authHeader?.replace(/^Bearer\s+/i, '');
    if (!token) {
      throw new UnauthorizedException('Authorization header required for logout');
    }
    await this.authService.revokeSession(token);
    return { success: true, message: 'Session revoked successfully' };
  }

  @Get('me')
  @HttpCode(HttpStatus.OK)
  async me(@Headers('authorization') authHeader?: string) {
    const token = authHeader?.replace(/^Bearer\s+/i, '');
    if (!token) {
      throw new UnauthorizedException('Authorization header required');
    }
    const session = await this.authService.validateSession(token);
    if (!session) {
      throw new UnauthorizedException('Session expired or invalid');
    }
    const memberships = await this.authService.getUserMemberships(session.user.id);
    return {
      user: session.user,
      memberships,
    };
  }
}
