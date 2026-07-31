import { ConflictException, Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { AuditService } from '../../common/audit.service';
import { LoginProtectionService } from './login-protection.service';
import type { SessionContext } from './auth.types';
import { newCsrfToken } from './cookie-security';

const BCRYPT_ROUNDS = 12;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private notifications: NotificationService,
    private audit: AuditService,
    private loginProtection: LoginProtectionService,
  ) {}

  async validateUser(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user?.password || !user.active) throw new UnauthorizedException('Invalid credentials');
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    return user;
  }

  async login(email: string, password: string, context: SessionContext = {}) {
    const normalizedEmail = email.trim().toLowerCase();
    const ipAddress = context.ipAddress ?? 'unknown';
    this.loginProtection.assertAllowed(normalizedEmail, ipAddress);
    let user;
    try {
      user = await this.validateUser(normalizedEmail, password);
    } catch (error) {
      this.loginProtection.recordFailure(normalizedEmail, ipAddress);
      await this.audit.log({
        action: 'AUTH_LOGIN_FAILED',
        entityType: 'User',
        metadata: { emailHash: this.hash(normalizedEmail) },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
      throw error;
    }
    this.loginProtection.recordSuccess(normalizedEmail, ipAddress);
    if (user.password && bcrypt.getRounds(user.password) < BCRYPT_ROUNDS) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { password: await bcrypt.hash(password, BCRYPT_ROUNDS) },
      });
    }
    const session = await this.createSession(user.id, context);
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
      sid: session.id,
    };
    const accessToken = this.jwt.sign(payload, { expiresIn: '15m' });
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });
    await this.audit.log({
      action: 'AUTH_LOGIN_SUCCEEDED',
      entityType: 'User',
      entityId: user.id,
      organizationId: user.organizationId ?? undefined,
      userId: user.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    return {
      accessToken,
      refreshToken: session.token,
      csrfToken: newCsrfToken(),
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        organizationId: user.organizationId,
      },
    };
  }

  async register(data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
  }, context: SessionContext = {}) {
    const exists = await this.prisma.user.findUnique({ where: { email: data.email } });
    if (exists) throw new ConflictException('Email already registered');
    const hash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    const user = await this.prisma.user.create({
      data: {
        email: data.email,
        password: hash,
        firstName: data.firstName,
        lastName: data.lastName,
        role: UserRole.CUSTOMER,
        provider: 'email',
        active: true,
      },
    });
    return this.login(data.email, data.password, context);
  }

  async me(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        organizationId: true,
      },
    });
  }

  /** OAuth providers — configure GOOGLE_* / MICROSOFT_* env vars. */
  getOauthStartUrl(provider: 'google' | 'microsoft', redirectUri: string, state: string) {
    this.assertAllowedRedirectUri(redirectUri);
    if (provider === 'google') {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      if (!clientId) throw new UnauthorizedException('GOOGLE_CLIENT_ID not configured');
      const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      u.searchParams.set('client_id', clientId);
      u.searchParams.set('redirect_uri', redirectUri);
      u.searchParams.set('response_type', 'code');
      u.searchParams.set('scope', 'openid email profile');
      u.searchParams.set('access_type', 'online');
      u.searchParams.set('prompt', 'select_account');
      u.searchParams.set('state', state);
      return u.toString();
    }

    const clientId = process.env.MICROSOFT_CLIENT_ID;
    if (!clientId) throw new UnauthorizedException('MICROSOFT_CLIENT_ID not configured');
    const tenant = process.env.MICROSOFT_TENANT_ID || 'common';
    const u = new URL(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`);
    u.searchParams.set('client_id', clientId);
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', 'openid email profile User.Read');
    u.searchParams.set('response_mode', 'query');
    u.searchParams.set('state', state);
    return u.toString();
  }

  async loginWithOauth(
    provider: 'google' | 'microsoft',
    code: string,
    redirectUri: string,
    context: SessionContext = {},
  ) {
    this.assertAllowedRedirectUri(redirectUri);
    const profile =
      provider === 'google'
        ? await this.exchangeGoogle(code, redirectUri)
        : await this.exchangeMicrosoft(code, redirectUri);

    let user = await this.prisma.user.findUnique({ where: { email: profile.email } });
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email: profile.email,
          firstName: profile.firstName,
          lastName: profile.lastName,
          role: UserRole.CUSTOMER,
          provider,
          providerId: profile.sub,
          emailVerified: true,
          emailVerifiedAt: new Date(),
          active: true,
        },
      });
    } else {
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          provider,
          providerId: profile.sub,
          emailVerified: true,
          lastLogin: new Date(),
        },
      });
    }

    const session = await this.createSession(user.id, context);
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
      sid: session.id,
    };
    const accessToken = this.jwt.sign(payload, { expiresIn: '15m' });
    await this.audit.log({
      action: 'AUTH_OAUTH_LOGIN_SUCCEEDED',
      entityType: 'User',
      entityId: user.id,
      organizationId: user.organizationId ?? undefined,
      userId: user.id,
      metadata: { provider },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    return {
      accessToken,
      refreshToken: session.token,
      csrfToken: newCsrfToken(),
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        organizationId: user.organizationId,
      },
    };
  }

  private async exchangeGoogle(code: string, redirectUri: string) {
    const clientId = process.env.GOOGLE_CLIENT_ID!;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) throw new UnauthorizedException('Google token exchange failed');
    const tokens = (await tokenRes.json()) as { access_token: string };
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!profileRes.ok) throw new UnauthorizedException('Google profile failed');
    const p = (await profileRes.json()) as {
      sub: string;
      email: string;
      email_verified?: boolean;
      given_name?: string;
      family_name?: string;
    };
    if (!p.email_verified) throw new UnauthorizedException('Google email is not verified');
    return {
      sub: p.sub,
      email: p.email.toLowerCase(),
      firstName: p.given_name ?? 'Google',
      lastName: p.family_name ?? 'User',
    };
  }

  private async exchangeMicrosoft(code: string, redirectUri: string) {
    const clientId = process.env.MICROSOFT_CLIENT_ID!;
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET!;
    const tenant = process.env.MICROSOFT_TENANT_ID || 'common';
    const tokenRes = await fetch(
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      },
    );
    if (!tokenRes.ok) throw new UnauthorizedException('Microsoft token exchange failed');
    const tokens = (await tokenRes.json()) as { access_token: string };
    const profileRes = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!profileRes.ok) throw new UnauthorizedException('Microsoft profile failed');
    const p = (await profileRes.json()) as {
      id: string;
      mail?: string;
      userPrincipalName?: string;
      givenName?: string;
      surname?: string;
    };
    const email = (p.mail || p.userPrincipalName || '').toLowerCase();
    if (!email) throw new UnauthorizedException('Microsoft account has no email');
    return {
      sub: p.id,
      email,
      firstName: p.givenName ?? 'Microsoft',
      lastName: p.surname ?? 'User',
    };
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    // Always return ok to avoid email enumeration
    if (!user?.password) {
      return { ok: true, message: 'Si el correo existe, enviamos instrucciones.' };
    }

    const raw = randomBytes(32).toString('hex');
    const hash = createHash('sha256').update(raw).digest('hex');
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: hash,
        passwordResetAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const webUrl = process.env.WEB_URL || 'http://localhost:3000';
    const resetUrl = `${webUrl}/login/reset?token=${raw}&email=${encodeURIComponent(user.email)}`;

    await this.notifications.enqueueEmail({
      to: user.email,
      subject: 'Restablecer contraseña — Boletera',
      template: 'password-reset',
      data: { resetUrl, firstName: user.firstName },
    });

    return {
      ok: true,
      message: 'Si el correo existe, enviamos instrucciones.',
      // Dev helper when SMTP missing
      ...(process.env.NODE_ENV !== 'production' ? { devResetUrl: resetUrl } : {}),
    };
  }

  async resetPassword(token: string, email: string, newPassword: string) {
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }
    const hash = createHash('sha256').update(token).digest('hex');
    const user = await this.prisma.user.findFirst({
      where: {
        email: email.toLowerCase(),
        passwordResetToken: hash,
        passwordResetAt: { gt: new Date() },
      },
    });
    if (!user) throw new BadRequestException('Invalid or expired reset token');

    const password = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          password,
          passwordResetToken: null,
          passwordResetAt: null,
        },
      }),
      this.prisma.session.deleteMany({ where: { userId: user.id } }),
    ]);
    await this.audit.log({
      action: 'AUTH_PASSWORD_RESET',
      entityType: 'User',
      entityId: user.id,
      organizationId: user.organizationId ?? undefined,
      userId: user.id,
    });

    return { ok: true, message: 'Contraseña actualizada. Ya puedes iniciar sesión.' };
  }

  async refresh(rawToken: string, context: SessionContext = {}) {
    const [sessionId] = rawToken.split('.');
    if (!sessionId) throw new UnauthorizedException('Invalid refresh token');
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { user: true },
    });
    if (!session || session.expiresAt <= new Date() || !session.user.active) {
      if (session) await this.prisma.session.delete({ where: { id: session.id } });
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (!this.safeHashMatch(rawToken, session.token)) {
      await this.prisma.session.deleteMany({ where: { userId: session.userId } });
      await this.audit.log({
        action: 'AUTH_REFRESH_REUSE_DETECTED',
        entityType: 'Session',
        entityId: session.id,
        organizationId: session.user.organizationId ?? undefined,
        userId: session.userId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
      throw new UnauthorizedException('Refresh token reuse detected');
    }
    const nextRawToken = `${session.id}.${randomBytes(48).toString('base64url')}`;
    const rotated = await this.prisma.session.updateMany({
      where: { id: session.id, token: session.token },
      data: {
        token: this.hash(nextRawToken),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    });
    if (rotated.count !== 1) {
      await this.prisma.session.deleteMany({ where: { userId: session.userId } });
      throw new UnauthorizedException('Refresh token reuse detected');
    }
    const user = session.user;
    return {
      accessToken: this.jwt.sign(
        {
          sub: user.id,
          email: user.email,
          role: user.role,
          organizationId: user.organizationId,
          sid: session.id,
        },
        { expiresIn: '15m' },
      ),
      refreshToken: nextRawToken,
      csrfToken: newCsrfToken(),
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        organizationId: user.organizationId,
      },
    };
  }

  async logout(rawToken: string | undefined, userId: string | undefined, context: SessionContext) {
    if (rawToken) {
      const [sessionId] = rawToken.split('.');
      if (sessionId) {
        const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
        if (session && this.safeHashMatch(rawToken, session.token)) {
          userId = session.userId;
          await this.prisma.session.delete({ where: { id: sessionId } });
        } else if (session) {
          await this.prisma.session.deleteMany({ where: { userId: session.userId } });
        }
      }
    }
    await this.audit.log({
      action: 'AUTH_LOGOUT',
      entityType: 'Session',
      userId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    return { ok: true };
  }

  async revokeAllSessions(userId: string, context: SessionContext) {
    const result = await this.prisma.session.deleteMany({ where: { userId } });
    await this.audit.log({
      action: 'AUTH_ALL_SESSIONS_REVOKED',
      entityType: 'User',
      entityId: userId,
      userId,
      metadata: { revokedCount: result.count },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    return { ok: true, revokedCount: result.count };
  }

  private async createSession(
    userId: string,
    context: SessionContext,
  ): Promise<{ id: string; token: string }> {
    const id = randomBytes(16).toString('hex');
    const rawToken = `${id}.${randomBytes(48).toString('base64url')}`;
    await this.prisma.session.create({
      data: {
        id,
        userId,
        token: this.hash(rawToken),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    });
    return { id, token: rawToken };
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private safeHashMatch(rawToken: string, expectedHash: string): boolean {
    const actual = Buffer.from(this.hash(rawToken), 'hex');
    const expected = Buffer.from(expectedHash, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  private assertAllowedRedirectUri(redirectUri: string): void {
    let parsed: URL;
    try {
      parsed = new URL(redirectUri);
    } catch {
      throw new BadRequestException('Invalid OAuth redirect URI');
    }
    const configured = (process.env.OAUTH_ALLOWED_REDIRECT_URIS ?? process.env.OAUTH_ADMIN_REDIRECT_URI ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const developmentDefault =
      process.env.NODE_ENV !== 'production'
        ? ['http://localhost:3001/login/oauth/callback']
        : [];
    if (![...configured, ...developmentDefault].includes(parsed.toString())) {
      throw new BadRequestException('OAuth redirect URI is not allowed');
    }
  }
}


