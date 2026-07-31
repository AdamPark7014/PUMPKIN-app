import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';
import { PERMISSIONS_KEY, Permission } from './permissions.decorator';
import type { UserRole } from '@prisma/client';

const hierarchy: Record<UserRole, number> = {
  CUSTOMER: 0,
  SCANNER: 1,
  ARTIST: 1,
  TAQUILLA: 2,
  VENUE_MANAGER: 3,
  PROMOTER: 4,
  ADMIN: 5,
  SUPER_ADMIN: 6,
};

const permissions: Record<UserRole, ReadonlySet<Permission>> = {
  CUSTOMER: new Set(['event:read', 'order:read', 'order:write']),
  SCANNER: new Set(['event:read', 'ticket:scan']),
  ARTIST: new Set(['analytics:read', 'event:read']),
  TAQUILLA: new Set(['event:read', 'order:read', 'order:write', 'payment:read']),
  VENUE_MANAGER: new Set(['analytics:read', 'event:read', 'ticket:scan', 'venue:manage']),
  PROMOTER: new Set([
    'analytics:read', 'data:export', 'event:read', 'event:write', 'order:read',
    'payment:read', 'price:write', 'venue:manage',
  ]),
  ADMIN: new Set([
    'analytics:read', 'audit:read', 'data:export', 'event:read', 'event:write',
    'order:read', 'order:write', 'payment:read', 'payment:refund', 'price:write',
    'role:write', 'tenant:manage', 'ticket:scan', 'venue:manage',
  ]),
  SUPER_ADMIN: new Set([
    'analytics:read', 'audit:read', 'data:export', 'event:read', 'event:write',
    'order:read', 'order:write', 'payment:read', 'payment:refund', 'price:write',
    'role:write', 'tenant:manage', 'ticket:scan', 'venue:manage',
  ]),
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredPermissions = this.reflector.getAllAndOverride<Permission[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!roles?.length && !requiredPermissions?.length) return true;
    const request = context.switchToHttp().getRequest<{ user?: { role?: UserRole } }>();
    const role = request.user?.role;
    if (!role || hierarchy[role] === undefined) return false;
    if (role === 'SUPER_ADMIN') return true;
    const roleAllowed =
      !roles?.length || roles.some((requiredRole) => hierarchy[role] >= hierarchy[requiredRole]);
    const permissionAllowed =
      !requiredPermissions?.length ||
      requiredPermissions.every((permission) => permissions[role].has(permission));
    return roleAllowed && permissionAllowed;
  }
}


