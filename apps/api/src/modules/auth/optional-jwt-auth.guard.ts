import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ACCESS_COOKIE, assertCsrf } from './cookie-security';
import type { AuthenticatedUser } from './auth.types';
import type { Request } from 'express';

@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  constructor(private jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const header = req.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const cookie = req.cookies?.[ACCESS_COOKIE];
    const token = bearer ?? cookie;
    if (!token) return true;
    try {
      const payload = await this.jwt.verifyAsync<Omit<AuthenticatedUser, 'authSource'>>(token);
      req.authSource = bearer ? 'bearer' : 'cookie';
      req.user = { ...payload, authSource: req.authSource };
    } catch {
      req.user = undefined;
    }
    if (
      req.user &&
      req.authSource === 'cookie' &&
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method)
    ) {
      assertCsrf(req);
    }
    return true;
  }
}


