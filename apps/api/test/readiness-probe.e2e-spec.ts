import { HealthController } from '../src/modules/health/health.controller';
import * as dbPkg from '@friendly-crm/db';

describe('GET /ready when the database is down', () => {
  const saved = { ...process.env };
  const realExecute = (dbPkg as any).db.execute;
  const controller = new HealthController();
  const res = () => {
    const r: any = { status: jest.fn(() => r), json: jest.fn(() => r) };
    return r;
  };

  beforeEach(() => {
    (dbPkg as any).db.execute = jest.fn().mockRejectedValue(new Error('password authentication failed for user "x"'));
    jest.spyOn(controller['logger'], 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    process.env = { ...saved };
    (dbPkg as any).db.execute = realExecute;
    jest.restoreAllMocks();
  });

  it('answers 503 outside tests, without the database error text', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.ALLOW_MEMORY_FALLBACK;
    const r = res();
    await controller.getReadiness(r);
    expect(r.status).toHaveBeenCalledWith(503);
    const body = r.json.mock.calls[0][0];
    expect(body).toMatchObject({ status: 'unready', database: 'unreachable' });
    expect(JSON.stringify(body)).not.toMatch(/password|user/);
  });

  it('stays ready where the memory fallback is allowed', async () => {
    process.env.NODE_ENV = 'test';
    const r = res();
    await controller.getReadiness(r);
    expect(r.status).toHaveBeenCalledWith(200);
  });
});
