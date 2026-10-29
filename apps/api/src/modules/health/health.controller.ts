import { Controller, Get, Res, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';
import { db } from '@friendly-crm/db';
import { sql } from 'drizzle-orm';
import { memoryFallbackAllowed } from '../../common/utils/db-fallback.util';

@Controller()
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  /**
   * 1. GET /api/health (and /health)
   * Liveness Probe: Verifies Node.js process is active
   */
  @Get('health')
  getLiveness() {
    return {
      status: 'ok',
      service: 'friendly-crm-api',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    };
  }

  /**
   * 2. GET /api/ready (and /ready)
   * Readiness Probe: Verifies critical dependencies (PostgreSQL database)
   */
  @Get('ready')
  async getReadiness(@Res() res: Response) {
    let dbStatus = 'disconnected';
    let isReady = true;

    try {
      if (typeof db?.execute === 'function') {
        await db.execute(sql`SELECT 1`);
        dbStatus = 'connected';
      } else {
        dbStatus = 'memory_mode';
      }
    } catch (err: any) {
      // An unreachable database means 503, except where the in-memory fallback is allowed (tests, opt-in local dev).
      // The error text goes to the log, not to this public response.
      this.logger.error(`Readiness check: database unreachable: ${err?.message ?? err}`);
      dbStatus = 'unreachable';
      if (!memoryFallbackAllowed()) {
        isReady = false;
      }
    }

    const payload = {
      status: isReady ? 'ready' : 'unready',
      database: dbStatus,
      timestamp: new Date().toISOString(),
    };

    return res
      .status(isReady ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE)
      .json(payload);
  }
}
