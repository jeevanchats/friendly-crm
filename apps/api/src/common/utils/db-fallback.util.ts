import { Logger, ServiceUnavailableException } from '@nestjs/common';

/**
 * The in-memory stores are for local development without Postgres and for the test suite only.
 * Anywhere else they must stay off: a database error would otherwise be reported as success and the data lost on restart.
 * Local opt-in: ALLOW_MEMORY_FALLBACK=true (ignored in production).
 */
export function memoryFallbackAllowed(): boolean {
  if (process.env.NODE_ENV === 'test') return true;
  return process.env.NODE_ENV !== 'production' && process.env.ALLOW_MEMORY_FALLBACK === 'true';
}

/**
 * Call from a catch around a database operation. Returns when the memory fallback is allowed (the caller then uses
 * its memory path); otherwise logs the real error and throws a 503 so the failure is visible.
 */
export function onDbError(logger: Logger, operation: string, err: any): void {
  if (!memoryFallbackAllowed()) {
    logger.error(`Postgres failed while ${operation}: ${err?.message ?? err}`);
    throw new ServiceUnavailableException('The service is temporarily unavailable. Please try again in a moment.');
  }
  if (process.env.NODE_ENV !== 'test') {
    logger.warn(`Postgres offline; using the in-memory store while ${operation}: ${err?.message ?? err}`);
  }
}
