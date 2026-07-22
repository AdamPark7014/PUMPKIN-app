import './load-env';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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

  // CORS
  app.enableCors({
    origin: (process.env.CORS_ORIGIN || 'http://localhost:3000').split(','),
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


