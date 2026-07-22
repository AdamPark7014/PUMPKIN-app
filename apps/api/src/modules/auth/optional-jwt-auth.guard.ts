import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  constructor(private jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      user?: { sub: string; email?: string };
    }>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return true;
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; email?: string }>(header.slice(7));
      req.user = { sub: payload.sub, email: payload.email };
    } catch {
      /* guest checkout */
    }
    return true;
  }
}


