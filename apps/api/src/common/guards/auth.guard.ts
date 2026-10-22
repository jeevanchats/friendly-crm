import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AuthService } from '../../modules/auth/auth.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers['authorization'];

    if (!authHeader || typeof authHeader !== 'string') {
      throw new UnauthorizedException('Authentication token required');
    }

    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      throw new UnauthorizedException('Malformed bearer token');
    }

    const validated = await this.authService.validateSession(token);
    if (!validated) {
      throw new UnauthorizedException('Session expired or revoked');
    }

    // Attach verified user to request (role will be set by TenantGuard from membership)
    request.user = {
      id: validated.user.id,
      phone: validated.user.phone,
      role: '',
    } as any;

    return true;
  }
}
