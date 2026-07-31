import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { assertCsrf } from './cookie-security';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const activated = await super.canActivate(context);
    const request = context.switchToHttp().getRequest<Request>();
    if (
      activated &&
      request.authSource === 'cookie' &&
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
    ) {
      assertCsrf(request);
    }
    return Boolean(activated);
  }
}


