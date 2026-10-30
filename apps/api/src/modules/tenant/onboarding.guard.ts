import { CanActivate, ExecutionContext, ForbiddenException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

/** Public sign-ups allowed per address per hour when they are switched on. */
export const SIGNUPS_PER_ADDRESS_PER_HOUR = 5;

const safeEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Who may create a business (POST /api/tenant/onboard).
 *
 * In production it is closed unless one of these is set:
 *  - ONBOARDING_KEY: the operator creates businesses by sending that key in the `x-onboarding-key` header (the pilot way).
 *  - ALLOW_PUBLIC_SIGNUP=true: anyone may, but only a few per address per hour.
 * Outside production (development and tests) it stays open, as before.
 */
@Injectable()
export class OnboardingGuard implements CanActivate {
  private readonly recent = new Map<string, number[]>();

  canActivate(context: ExecutionContext): boolean {
    if (process.env.NODE_ENV !== 'production') return true;

    const req = context.switchToHttp().getRequest();
    const key = process.env.ONBOARDING_KEY;
    if (key) {
      const sent = req.headers?.['x-onboarding-key'];
      if (typeof sent === 'string' && safeEqual(sent, key)) return true;
      // A wrong or missing key is refused, unless public sign-up has been switched on deliberately too
      if (process.env.ALLOW_PUBLIC_SIGNUP !== 'true') throw new ForbiddenException('Creating a business needs the onboarding key.');
    }

    if (process.env.ALLOW_PUBLIC_SIGNUP !== 'true') {
      throw new ForbiddenException('Sign-up is closed. Ask the administrator to create your business.');
    }

    const address = String(req.ip ?? req.socket?.remoteAddress ?? 'unknown');
    const now = Date.now();
    const recent = (this.recent.get(address) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length >= SIGNUPS_PER_ADDRESS_PER_HOUR) {
      throw new HttpException('Too many sign-ups from this address. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
    recent.push(now);
    this.recent.set(address, recent);
    return true;
  }
}
