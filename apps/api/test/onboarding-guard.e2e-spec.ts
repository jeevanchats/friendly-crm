import { ExecutionContext, ForbiddenException, HttpException } from '@nestjs/common';
import { OnboardingGuard, SIGNUPS_PER_ADDRESS_PER_HOUR } from '../src/modules/tenant/onboarding.guard';

/** Who may create a business: closed in production unless a key or deliberate public sign-up is set. */
describe('Onboarding guard', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  const ctx = (headers: Record<string, string> = {}, ip = '10.0.0.1'): ExecutionContext =>
    ({ switchToHttp: () => ({ getRequest: () => ({ headers, ip }) }) }) as unknown as ExecutionContext;
  const production = (extra: Record<string, string> = {}) => {
    process.env.NODE_ENV = 'production';
    delete process.env.ONBOARDING_KEY;
    delete process.env.ALLOW_PUBLIC_SIGNUP;
    Object.assign(process.env, extra);
  };

  it('stays open outside production (development and tests)', () => {
    process.env.NODE_ENV = 'development';
    expect(new OnboardingGuard().canActivate(ctx())).toBe(true);
    process.env.NODE_ENV = 'test';
    expect(new OnboardingGuard().canActivate(ctx())).toBe(true);
  });

  it('is closed in production when nothing is configured', () => {
    production();
    expect(() => new OnboardingGuard().canActivate(ctx())).toThrow(ForbiddenException);
    expect(() => new OnboardingGuard().canActivate(ctx({ 'x-onboarding-key': 'anything' }))).toThrow(ForbiddenException);
  });

  it('with an onboarding key, only the right key gets in', () => {
    production({ ONBOARDING_KEY: 'pilot-secret-123' });
    const guard = new OnboardingGuard();
    expect(guard.canActivate(ctx({ 'x-onboarding-key': 'pilot-secret-123' }))).toBe(true);
    expect(() => guard.canActivate(ctx({ 'x-onboarding-key': 'pilot-secret-124' }))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx({ 'x-onboarding-key': 'short' }))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx())).toThrow(ForbiddenException);
  });

  it('public sign-up, when switched on, is limited per address', () => {
    production({ ALLOW_PUBLIC_SIGNUP: 'true' });
    const guard = new OnboardingGuard();
    for (let i = 0; i < SIGNUPS_PER_ADDRESS_PER_HOUR; i++) expect(guard.canActivate(ctx({}, '1.2.3.4'))).toBe(true);
    expect(() => guard.canActivate(ctx({}, '1.2.3.4'))).toThrow(HttpException); // the next one is refused (429)
    expect(guard.canActivate(ctx({}, '5.6.7.8'))).toBe(true); // another address is unaffected
  });

  it('with both a key and public sign-up on, a wrong key falls to the public (limited) path', () => {
    production({ ONBOARDING_KEY: 'k', ALLOW_PUBLIC_SIGNUP: 'true' });
    const guard = new OnboardingGuard();
    expect(guard.canActivate(ctx({ 'x-onboarding-key': 'k' }))).toBe(true);
    expect(guard.canActivate(ctx({ 'x-onboarding-key': 'wrong' }, '9.9.9.9'))).toBe(true);
  });
});

describe('Onboarding route (over HTTP)', () => {
  const { Test } = require('@nestjs/testing');
  const { AppModule } = require('../src/app.module');
  const saved = { ...process.env };
  let app: any;
  let baseUrl: string;

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = fixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.listen(0);
    baseUrl = await app.getUrl();
  });
  afterAll(async () => {
    process.env = { ...saved };
    await app.close();
  });

  const post = (headers: Record<string, string> = {}) =>
    fetch(`${baseUrl}/api/tenants/onboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ name: 'Guard Test Press', slug: `guard-test-${Date.now()}`, industry: 'printing', ownerPhone: '+919877700001', ownerName: 'Test Owner' }),
    });

  it('is refused (403) in production with no key, and with a wrong key', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ALLOW_PUBLIC_SIGNUP;
    process.env.ONBOARDING_KEY = 'pilot-secret-123';
    expect((await post()).status).toBe(403);
    expect((await post({ 'x-onboarding-key': 'wrong' })).status).toBe(403);
    delete process.env.ONBOARDING_KEY;
    expect((await post()).status).toBe(403);
  });

  it('gets past the guard in production with the right key (whatever the database then says, it is not 403)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ONBOARDING_KEY = 'pilot-secret-123';
    expect((await post({ 'x-onboarding-key': 'pilot-secret-123' })).status).not.toBe(403);
  });
});
