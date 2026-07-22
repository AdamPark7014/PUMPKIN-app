import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

/**
 * Ensures :organizationId / :orgId (param, query, or body) matches the JWT org,
 * unless the user is SUPER_ADMIN.
 */
@Injectable()
export class OrgAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const user = req.user;
    if (!user) throw new ForbiddenException('Authentication required');

    if (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN') {
      return true;
    }

    const requested =
      req.params?.organizationId ||
      req.params?.orgId ||
      req.query?.organizationId ||
      req.query?.orgId ||
      req.body?.organizationId ||
      req.body?.orgId;

    if (!requested) {
      return true;
    }

    if (!user.organizationId || user.organizationId !== requested) {
      throw new ForbiddenException('Organization access denied');
    }

    return true;
  }
}
