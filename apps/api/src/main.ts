import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody: webhook signatures (WhatsApp) must be verified against the exact bytes received.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim())
    : ['http://localhost:3000', 'http://127.0.0.1:3000'];

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV === 'test') {
        callback(null, true);
      } else {
        callback(new Error('Blocked by CORS policy'));
      }
    },
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type,Accept,Authorization,X-Tenant-Id,X-Industry-Key',
  });

  // Prefix matches /api/crm/... endpoints
  app.setGlobalPrefix('api');

  const port = process.env.PORT || 4000;
  await app.listen(port, '0.0.0.0');
  console.log(`[Friendly CRM API] Modular Monolith running at http://localhost:${port}/api`);
}

bootstrap();
