import { Body, Controller, Get, Post, Query, Res, UseGuards, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  login(@Body() body: { email: string; password: string }) {
    return this.auth.login(body.email, body.password);
  }

  @Post('register')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  register(
    @Body()
    body: { email: string; password: string; firstName: string; lastName: string },
  ) {
    return this.auth.register(body);
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
    return res.redirect(this.auth.getOauthStartUrl('google', uri));
  }

  @Get('oauth/microsoft/start')
  microsoftStart(@Query('redirect_uri') redirectUri: string, @Res() res: Response) {
    const uri =
      redirectUri ||
      process.env.OAUTH_ADMIN_REDIRECT_URI ||
      'http://localhost:3001/login/oauth/callback';
    return res.redirect(this.auth.getOauthStartUrl('microsoft', uri));
  }

  @Post('forgot-password')
  forgotPassword(@Body() body: { email: string }) {
    return this.auth.forgotPassword(body.email);
  }

  @Post('reset-password')
  resetPassword(@Body() body: { email: string; token: string; password: string }) {
    return this.auth.resetPassword(body.token, body.email, body.password);
  }

  @Post('oauth/google/callback')
  googleCallback(@Body() body: { code: string; redirect_uri?: string }) {
    const uri =
      body.redirect_uri ||
      process.env.OAUTH_ADMIN_REDIRECT_URI ||
      'http://localhost:3001/login/oauth/callback';
    return this.auth.loginWithOauth('google', body.code, uri);
  }

  @Post('oauth/microsoft/callback')
  microsoftCallback(@Body() body: { code: string; redirect_uri?: string }) {
    const uri =
      body.redirect_uri ||
      process.env.OAUTH_ADMIN_REDIRECT_URI ||
      'http://localhost:3001/login/oauth/callback';
    return this.auth.loginWithOauth('microsoft', body.code, uri);
  }
}
