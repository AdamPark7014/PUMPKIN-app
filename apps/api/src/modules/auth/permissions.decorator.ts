import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'auth:permissions';

export const Permissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export type Permission =
  | 'analytics:read'
  | 'audit:read'
  | 'data:export'
  | 'event:read'
  | 'event:write'
  | 'order:read'
  | 'order:write'
  | 'payment:read'
  | 'payment:refund'
  | 'price:write'
  | 'role:write'
  | 'tenant:manage'
  | 'ticket:scan'
  | 'venue:manage';
