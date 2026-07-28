import './load-env';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(
    helmet({
      // API is consumed cross-origin by web/admin/taquilla in local and prod.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    }),
  );

  // Global prefix
  app.setGlobalPrefix('api/v1');

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  // CORS — web :3000/:3010, admin :3001, taquilla :3002 (+ LAN / loopback en dev)
  const configured = (process.env.CORS_ORIGIN ||
    'http://localhost:3000,http://localhost:3010,http://localhost:3001,http://localhost:3002,http://127.0.0.1:3000,http://127.0.0.1:3010,http://127.0.0.1:3001,http://127.0.0.1:3002'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (configured.includes('*') || configured.includes(origin)) {
        return callback(null, true);
      }
      // Always allow loopback (web/admin/taquilla may use alternate ports in local).
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
        return callback(null, true);
      }
      const isDev = process.env.NODE_ENV !== 'production';
      if (
        isDev &&
        (/^https?:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/i.test(origin) ||
          /^https?:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/i.test(origin))
      ) {
        return callback(null, true);
      }
      // Prefer false over Error — Error becomes HTTP 500 via Nest exception filter.
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Channel',
      'X-Cashier-Id',
      'Idempotency-Key',
      'X-Forwarded-For',
    ],
  });

  // Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('Boletera Platform API')
    .setDescription(
      'Enterprise Ticketing System - Official API Documentation. Handles discovery, inventory, pricing, orders, payments, fraud detection, resale marketplace, and analytics.',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .addServer('http://localhost:4000', 'Development')
    .addServer('https://api.boletera.com', 'Production')
    .addTag('Discovery', 'Event search and discovery endpoints')
    .addTag('Inventory', 'Ticket availability and inventory management')
    .addTag('Pricing', 'Dynamic pricing and pricing information')
    .addTag('Orders', 'Order management and transaction processing')
    .addTag('Payments', 'Payment processing and methods')
    .addTag('Resale', 'Secondary market and resale functionality')
    .addTag('Analytics', 'Reporting and analytics endpoints')
    .addTag('Fraud', 'Fraud detection and security')
    .addTag('Admin', 'Admin operations')
    .addTag('Access', 'Venue entry scanning and QR validation')
    .addTag('Tenant', 'Multi-tenant resolution')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.API_PORT || 4000;
  const host = process.env.API_HOST || '0.0.0.0';

  await app.listen(port, host);
  console.log(`Boletera API running on ${host}:${port}`);
  console.log(`API Documentation: http://localhost:${port}/api/docs`);
}

void bootstrap().catch((error) => {
  console.error('Bootstrap error:', error);
  process.exit(1);
});


