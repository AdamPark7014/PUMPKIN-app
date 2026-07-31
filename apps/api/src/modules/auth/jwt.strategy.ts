import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { requireJwtSecret } from './jwt-secret';
import { ACCESS_COOKIE } from './cookie-security';
import type { AuthenticatedUser } from './auth.types';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { UnauthorizedException } from '@nestjs/common';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request: Request) => {
          const bearer = ExtractJwt.fromAuthHeaderAsBearerToken()(request);
          if (bearer) {
            request.authSource = 'bearer';
            return bearer;
          }
          const cookie = request.cookies?.[ACCESS_COOKIE];
          if (cookie) request.authSource = 'cookie';
          return cookie ?? null;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: requireJwtSecret(),
      passReqToCallback: true,
    });
  }

  async validate(
    request: Request,
    payload: Omit<AuthenticatedUser, 'authSource'>,
  ): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        role: true,
        organizationId: true,
        active: true,
      },
    });
    if (!user?.active) throw new UnauthorizedException();
    if (payload.sid) {
      const session = await this.prisma.session.findUnique({
        where: { id: payload.sid },
        select: { userId: true, expiresAt: true },
      });
      if (
        !session ||
        session.userId !== user.id ||
        session.expiresAt <= new Date()
      ) {
        throw new UnauthorizedException();
      }
    }
    return {
      sub: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId ?? undefined,
      sid: payload.sid,
      authSource: request.authSource,
    };
  }
}


