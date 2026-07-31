import { BadRequestException, Injectable } from '@nestjs/common';
import { TenantContextService } from '../../common/tenant-context.service';

/**
 * Request-scoped organization resolution on top of `TenantContextService`.
 *
 * `TenantContextService.requireOrganization()` intentionally refuses to answer
 * for cross-tenant operators (`SUPER_ADMIN`), so every tenant-owned query needs
 * one place that decides which organization a request may touch.
 */
@Injectable()
export class TenantScopeService {
  constructor(private readonly context: TenantContextService) {}

  /**
   * Organization the current request is allowed to read and write.
   *
   * `SUPER_ADMIN` must name the tenant explicitly (or carry one on the token);
   * everyone else is pinned to their own organization and any explicitly
   * requested organization must match it.
   */
  resolve(requested?: string): string {
    const context = this.context.current();
    if (context.privileged) {
      const organizationId = requested ?? context.organizationId;
      if (!organizationId) {
        throw new BadRequestException(
          'organizationId is required for cross-tenant operators',
        );
      }
      return organizationId;
    }
    const organizationId = this.context.requireOrganization();
    if (requested) this.context.assertOrganization(requested);
    return organizationId;
  }

  /** Fails closed when an indirectly resolved organization is not the caller's. */
  assert(organizationId: string): void {
    this.context.assertOrganization(organizationId);
  }

  /**
   * Boundary check for endpoints that also serve anonymous traffic: unauthenticated
   * callers are allowed through, authenticated tenant-bound callers are not allowed
   * to step outside their own organization.
   */
  assertAnonymousOrOwn(organizationId: string): void {
    const context = this.context.current();
    if (context.privileged || !context.organizationId) return;
    this.context.assertOrganization(organizationId);
  }

  /** Authenticated user id, used as the audit actor. */
  actorId(): string | undefined {
    return this.context.current().userId;
  }

  isPrivileged(): boolean {
    return this.context.current().privileged;
  }
}
