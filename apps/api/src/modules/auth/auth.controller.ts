import { Body, Controller, Get, Post, Query, Res, UseGuards, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request as ExpressRequest, Response } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import {
  assertCsrf,
  clearAuthCookies,
  issueAuthCookies,
  assertOauthState,
  issueOauthState,
  REFRESH_COOKIE,
} from './cookie-security';
import {
  ForgotPasswordDto,
  LoginDto,
  OauthCallbackDto,
  RegisterDto,
  ResetPasswordDto,
} from './auth.dto';
import type { AuthenticatedUser, SessionContext } from './auth.types';
import { randomBytes } from 'crypto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(
    @Body() body: LoginDto,
    @Request() request: ExpressRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.login(body.email, body.password, this.context(request));
    issueAuthCookies(response, result.accessToken, result.refreshToken, result.csrfToken);
    return this.publicResult(result);
  }

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async register(
    @Body() body: RegisterDto,
    @Request() request: ExpressRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.register(body, this.context(request));
    issueAuthCookies(response, result.accessToken, result.refreshToken, result.csrfToken);
    return this.publicResult(result);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  me(@Request() req: { user: { sub: string } }) {
    return this.auth.me(req.user.sub);
  }

  @Get('oauth/google/start')
  googleStart(@Query('redirect_uri') redirectUri: string, @Res() res: Response) {
    const uri =
      redirectUri ||
      process.env.OAUTH_ADMIN_REDIRECT_URI ||
      'http://localhost:3001/login/oauth/callback';
    const state = randomBytes(32).toString('base64url');
    issueOauthState(res, state);
    return res.redirect(this.auth.getOauthStartUrl('google', uri, state));
  }

  @Get('oauth/microsoft/start')
  microsoftStart(@Query('redirect_uri') redirectUri: string, @Res() res: Response) {
    const uri =
      redirectUri ||
      process.env.OAUTH_ADMIN_REDIRECT_URI ||
      'http://localhost:3001/login/oauth/callback';
    const state = randomBytes(32).toString('base64url');
    issueOauthState(res, state);
    return res.redirect(this.auth.getOauthStartUrl('microsoft', uri, state));
  }

  @Post('forgot-password')
  @Throttle({ default: { limit: 3, ttl: 15 * 60_000 } })
  forgotPassword(@Body() body: ForgotPasswordDto) {
    return this.auth.forgotPassword(body.email);
  }

  @Post('reset-password')
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  resetPassword(@Body() body: ResetPasswordDto) {
    return this.auth.resetPassword(body.token, body.email, body.password);
  }

  @Post('oauth/google/callback')
  async googleCallback(
    @Body() body: OauthCallbackDto,
    @Request() request: ExpressRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertOauthState(request, body.state);
    const uri =
      body.redirect_uri ||
      process.env.OAUTH_ADMIN_REDIRECT_URI ||
      'http://localhost:3001/login/oauth/callback';
    const result = await this.auth.loginWithOauth('google', body.code, uri, this.context(request));
    issueAuthCookies(response, result.accessToken, result.refreshToken, result.csrfToken);
    return this.publicResult(result);
  }

  @Post('oauth/microsoft/callback')
  async microsoftCallback(
    @Body() body: OauthCallbackDto,
    @Request() request: ExpressRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertOauthState(request, body.state);
    const uri =
      body.redirect_uri ||
      process.env.OAUTH_ADMIN_REDIRECT_URI ||
      'http://localhost:3001/login/oauth/callback';
    const result = await this.auth.loginWithOauth(
      'microsoft',
      body.code,
      uri,
      this.context(request),
    );
    issueAuthCookies(response, result.accessToken, result.refreshToken, result.csrfToken);
    return this.publicResult(result);
  }

  @Post('refresh')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async refresh(
    @Request() request: ExpressRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertCsrf(request);
    const token = request.cookies?.[REFRESH_COOKIE];
    if (!token) return this.auth.refresh('', this.context(request));
    const result = await this.auth.refresh(token, this.context(request));
    issueAuthCookies(response, result.accessToken, result.refreshToken, result.csrfToken);
    return this.publicResult(result);
  }

  @Post('logout')
  async logout(
    @Request() request: ExpressRequest & { user?: AuthenticatedUser },
    @Res({ passthrough: true }) response: Response,
  ) {
    if (request.cookies?.[REFRESH_COOKIE]) assertCsrf(request);
    const result = await this.auth.logout(
      request.cookies?.[REFRESH_COOKIE],
      request.user?.sub,
      this.context(request),
    );
    clearAuthCookies(response);
    return result;
  }

  @Post('sessions/revoke-all')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async revokeAll(
    @Request() request: ExpressRequest & { user: AuthenticatedUser },
    @Res({ passthrough: true }) response: Response,
  ) {
    if (request.user.authSource === 'cookie') assertCsrf(request);
    const result = await this.auth.revokeAllSessions(request.user.sub, this.context(request));
    clearAuthCookies(response);
    return result;
  }

  private context(request: ExpressRequest): SessionContext {
    const userAgent = request.headers['user-agent'];
    return {
      ipAddress: request.ip ?? request.socket.remoteAddress,
      userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 512) : undefined,
    };
  }

  private publicResult<T extends { accessToken: string; user: unknown }>(
    result: T,
  ): Pick<T, 'accessToken' | 'user'> {
    return { accessToken: result.accessToken, user: result.user };
  }
}
