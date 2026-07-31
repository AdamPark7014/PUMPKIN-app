import { UserRole } from '@prisma/client';

/** Roles that can be granted through the tenant team management endpoints. */
export const TEAM_ROLES = [
  UserRole.PROMOTER,
  UserRole.VENUE_MANAGER,
  UserRole.ADMIN,
  UserRole.TAQUILLA,
  UserRole.SCANNER,
] as const;

export type TeamRole = (typeof TEAM_ROLES)[number];

/** Must stay aligned with the hierarchy table in `auth/roles.guard.ts`. */
const ROLE_RANK: Record<UserRole, number> = {
  CUSTOMER: 0,
  SCANNER: 1,
  ARTIST: 1,
  TAQUILLA: 2,
  VENUE_MANAGER: 3,
  PROMOTER: 4,
  ADMIN: 5,
  SUPER_ADMIN: 6,
};

export function isTeamRole(role: UserRole): role is TeamRole {
  return (TEAM_ROLES as readonly UserRole[]).includes(role);
}

export function rankOf(role: UserRole): number {
  return ROLE_RANK[role];
}
