import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';
import { OrgAccessGuard } from './org-access.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { requireJwtSecret } from './jwt-secret';
import { LoginProtectionService } from './login-protection.service';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TenantContextInterceptor } from '../../common/tenant-context.interceptor';
import { TenantContextService } from '../../common/tenant-context.service';
import { AntiAbuseInterceptor } from '../../common/anti-abuse.interceptor';

@Module({
  imports: [
    PrismaModule,
    NotificationModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: requireJwtSecret(),
      signOptions: { expiresIn: '15m' },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    OptionalJwtAuthGuard,
    OrgAccessGuard,
    JwtAuthGuard,
    RolesGuard,
    LoginProtectionService,
    TenantContextService,
    TenantContextInterceptor,
    AntiAbuseInterceptor,
    { provide: APP_INTERCEPTOR, useExisting: TenantContextInterceptor },
    { provide: APP_INTERCEPTOR, useExisting: AntiAbuseInterceptor },
  ],
  exports: [
    AuthService,
    JwtModule,
    OptionalJwtAuthGuard,
    OrgAccessGuard,
    JwtAuthGuard,
    RolesGuard,
    TenantContextService,
  ],
})
export class AuthModule {}


