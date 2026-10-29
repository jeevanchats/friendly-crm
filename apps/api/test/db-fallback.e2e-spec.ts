import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { memoryFallbackAllowed, onDbError } from '../src/common/utils/db-fallback.util';

describe('memory fallback rule', () => {
  const saved = { ...process.env };
  const logger = new Logger('test');
  beforeEach(() => {
    jest.spyOn(logger, 'error').mockImplementation(() => undefined);
    jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    process.env = { ...saved };
    jest.restoreAllMocks();
  });

  it('is allowed under test', () => {
    process.env.NODE_ENV = 'test';
    expect(memoryFallbackAllowed()).toBe(true);
    expect(() => onDbError(logger, 'saving', new Error('boom'))).not.toThrow();
  });

  it('turns a database error into a 503 in development unless ALLOW_MEMORY_FALLBACK=true', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.ALLOW_MEMORY_FALLBACK;
    expect(() => onDbError(logger, 'saving a payment', new Error('boom'))).toThrow(ServiceUnavailableException);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('boom'));

    process.env.ALLOW_MEMORY_FALLBACK = 'true';
    expect(() => onDbError(logger, 'saving a payment', new Error('boom'))).not.toThrow();
  });

  it('never allows it in production, even with the switch on', () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_MEMORY_FALLBACK = 'true';
    expect(memoryFallbackAllowed()).toBe(false);
    expect(() => onDbError(logger, 'saving', new Error('boom'))).toThrow(ServiceUnavailableException);
  });

  it('does not leak the database error to the caller', () => {
    process.env.NODE_ENV = 'production';
    const err = (() => { try { onDbError(logger, 'saving', new Error('password authentication failed for user x')); } catch (e) { return e as Error; } })();
    expect(err!.message).not.toMatch(/password|user x/);
  });
});
