import { ServiceUnavailableException } from '@nestjs/common';

// A database that is down: every call throws.
jest.mock('@friendly-crm/db', () => {
  const boom = () => {
    throw new Error('connection refused');
  };
  return {
    db: { select: boom, insert: boom, update: boom, execute: boom },
    otpVerifications: {},
    sessions: {},
    users: {},
    memberships: {},
    tenants: {},
    sql: () => ({}),
  };
});

import { AuthService } from '../src/modules/auth/auth.service';
import { DevSmsGateway } from '../src/modules/auth/sms-gateway';

describe('AuthService when Postgres fails', () => {
  const original = { NODE_ENV: process.env.NODE_ENV, ALLOW: process.env.ALLOW_MEMORY_FALLBACK, GATEWAY: process.env.ENABLE_DEV_SMS_GATEWAY };
  const service = () => new AuthService(new DevSmsGateway());
  const set = (nodeEnv: string, allow?: string) => {
    (process.env as any).NODE_ENV = nodeEnv;
    if (allow === undefined) delete process.env.ALLOW_MEMORY_FALLBACK;
    else process.env.ALLOW_MEMORY_FALLBACK = allow;
    process.env.ENABLE_DEV_SMS_GATEWAY = 'true';
  };

  afterAll(() => {
    (process.env as any).NODE_ENV = original.NODE_ENV;
    if (original.ALLOW === undefined) delete process.env.ALLOW_MEMORY_FALLBACK;
    else process.env.ALLOW_MEMORY_FALLBACK = original.ALLOW;
    if (original.GATEWAY === undefined) delete process.env.ENABLE_DEV_SMS_GATEWAY;
    else process.env.ENABLE_DEV_SMS_GATEWAY = original.GATEWAY;
  });

  it.each([
    ['production', undefined],
    ['production', 'true'], // the flag is ignored in production
    ['development', undefined],
    ['development', 'false'],
  ])('fails loudly with 503 in %s (ALLOW_MEMORY_FALLBACK=%s)', async (env, allow) => {
    set(env, allow);
    const auth = service();
    await expect(auth.requestOtp({ phone: '+919840960001', countryCode: '+91' } as any)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(auth.validateSession('a'.repeat(64))).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(auth.revokeSession('a'.repeat(64))).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(auth.getUserMemberships('11111111-1111-4111-8111-111111111111')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('does not keep a sign-in code or session in memory where the fallback is off', async () => {
    set('production');
    const auth = service();
    await expect(auth.requestOtp({ phone: '+919840960002', countryCode: '+91' } as any)).rejects.toThrow();
    expect(DevSmsGateway.getLatestOtp('+919840960002')).toBeUndefined();
  });

  it.each([
    ['test', undefined],
    ['development', 'true'],
  ])('still works from memory in %s (ALLOW_MEMORY_FALLBACK=%s)', async (env, allow) => {
    set(env, allow);
    const auth = service();
    const phone = '+919840960003';
    auth.registerUser({ id: '22222222-2222-4222-8222-222222222222', fullName: 'Offline User', phone });
    await auth.requestOtp({ phone, countryCode: '+91' } as any);
    const code = DevSmsGateway.getLatestOtp(phone)!;
    const session = await auth.verifyOtp({ phone, code } as any);
    expect(session.token).toHaveLength(64);
    expect((await auth.validateSession(session.token))?.user.phone).toBe(phone);
  });
});
