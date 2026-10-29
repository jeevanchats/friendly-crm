import { BadGatewayException } from '@nestjs/common';
import { Fast2SmsGateway } from '../src/modules/auth/fast2sms-gateway';

describe('Fast2SmsGateway', () => {
  const gateway = new Fast2SmsGateway();
  const realFetch = global.fetch;
  const saved = { ...process.env };

  const mockFetch = (status: number, json: unknown) => {
    const fn = jest.fn().mockResolvedValue({ ok: status < 400, status, json: async () => json });
    global.fetch = fn as any;
    return fn;
  };

  beforeEach(() => {
    process.env.FAST2SMS_API_KEY = 'test-key';
  });
  afterEach(() => {
    global.fetch = realFetch;
    process.env = { ...saved };
  });

  it('is never used under test, even with a key set', () => {
    expect(Fast2SmsGateway.isConfigured()).toBe(false);
  });

  it('sends the code on the otp route to the 10-digit number', async () => {
    const fetchMock = mockFetch(200, { return: true, message: ['SMS sent successfully.'] });
    await expect(gateway.sendOtp('+919840960002', '123456')).resolves.toBe(true);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://www.fast2sms.com/dev/bulkV2');
    expect(init.headers.authorization).toBe('test-key');
    expect(JSON.parse(init.body)).toEqual({ route: 'otp', numbers: '9840960002', variables_values: '123456' });
  });

  it('uses the approved template on the dlt route', async () => {
    process.env.FAST2SMS_ROUTE = 'dlt';
    process.env.FAST2SMS_SENDER_ID = 'FRNDLY';
    process.env.FAST2SMS_TEMPLATE_ID = '123';
    const fetchMock = mockFetch(200, { return: true });
    await gateway.sendOtp('+919840960002', '654321');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      route: 'dlt',
      sender_id: 'FRNDLY',
      message: '123',
      variables_values: '654321',
    });
  });

  it('fails with a generic message, not the provider reason or the code, when Fast2SMS refuses', async () => {
    mockFetch(200, { return: false, status_code: 412, message: ['Invalid Authentication, Check Authorization Key'] });
    const err = await gateway.sendOtp('+919840960002', '123456').catch((e) => e);
    expect(err).toBeInstanceOf(BadGatewayException);
    expect(err.message).not.toMatch(/Authorization|123456/);
  });

  it('fails the same way when Fast2SMS cannot be reached', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any;
    await expect(gateway.sendOtp('+919840960002', '123456')).rejects.toBeInstanceOf(BadGatewayException);
  });
});
