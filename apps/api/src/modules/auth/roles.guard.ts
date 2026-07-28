import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles?.length) return true;
    const { user } = context.switchToHttp().getRequest();
    // SUPER_ADMIN implicitly has every permission — requiring every
    // @Roles() decorator across the API to remember to list it too is how
    // this org's own platform admin ends up locked out of endpoints (e.g.
    // the event hub) whenever a new route is added without it.
    if (user?.role === 'SUPER_ADMIN') return true;
    return roles.includes(user?.role);
  }
}


