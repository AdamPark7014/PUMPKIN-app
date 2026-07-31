import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantContextService } from '../../common/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';

const activeLayoutInclude = {
  sections: {
    include: { seats: { include: { row: true as const } } },
    orderBy: { sortOrder: 'asc' as const },
  },
} as const;

export type ActiveLayoutWithRelations = {
  id: string;
  venueId: string;
  name: string;
  version: number;
  mapData: unknown;
  metadata: unknown;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  sections: Array<{
    id: string;
    name: string;
    slug: string;
    color: string;
    sortOrder: number;
    metadata: unknown;
    seats: Array<{
      id: string;
      label: string;
      x: number;
      y: number;
      rotation: number;
      tier: string | null;
      coord3d: unknown;
      viewQuality: number | null;
      row: { label: string } | null;
    }>;
  }>;
};

@Injectable()
export class LayoutAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /**
   * Resolves the effective organization for a tenant-scoped write/read.
   * SUPER_ADMIN (privileged) may omit org and operate cross-tenant via resource lookup.
   */
  resolveOrganizationId(explicitOrganizationId?: string): string | undefined {
    const ctx = this.tenant.current();
    if (explicitOrganizationId) {
      this.tenant.assertOrganization(explicitOrganizationId);
      return explicitOrganizationId;
    }
    if (ctx.privileged) return undefined;
    return this.tenant.requireOrganization();
  }

  async requireVenue(venueId: string, organizationId?: string) {
    const orgId = this.resolveOrganizationId(organizationId);
    const venue = orgId
      ? await this.prisma.venue.findFirst({
          where: { id: venueId, organizationId: orgId },
        })
      : await this.prisma.venue.findUnique({ where: { id: venueId } });
    if (!venue) throw new NotFoundException('Venue not found');
    this.tenant.assertOrganization(venue.organizationId);
    return venue;
  }

  async requireEvent(eventId: string, organizationId?: string) {
    const orgId = this.resolveOrganizationId(organizationId);
    const event = orgId
      ? await this.prisma.event.findFirst({
          where: { id: eventId, organizationId: orgId },
        })
      : await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event not found');
    this.tenant.assertOrganization(event.organizationId);
    return event;
  }

  async requireLayoutForOrg(layoutId: string, organizationId?: string) {
    const orgId = this.resolveOrganizationId(organizationId);
    const layout = await this.prisma.venueLayout.findFirst({
      where: orgId
        ? { id: layoutId, venue: { organizationId: orgId } }
        : { id: layoutId },
      include: {
        venue: { select: { id: true, organizationId: true, name: true } },
        sections: { include: { seats: true } },
      },
    });
    if (!layout) throw new NotFoundException('Layout not found');
    this.tenant.assertOrganization(layout.venue.organizationId);
    return layout;
  }

  async findActiveLayout(
    venueId: string,
    organizationId?: string,
  ): Promise<{ venue: { id: string; name: string; slug: string; organizationId: string; totalCapacity: number }; layout: ActiveLayoutWithRelations | null }> {
    const orgId = this.resolveOrganizationId(organizationId);
    const venue = orgId
      ? await this.prisma.venue.findFirst({
          where: { id: venueId, organizationId: orgId },
          include: {
            layouts: {
              where: { isActive: true },
              orderBy: { updatedAt: 'desc' },
              take: 1,
              include: activeLayoutInclude,
            },
          },
        })
      : await this.prisma.venue.findUnique({
          where: { id: venueId },
          include: {
            layouts: {
              where: { isActive: true },
              orderBy: { updatedAt: 'desc' },
              take: 1,
              include: activeLayoutInclude,
            },
          },
        });
    if (!venue) throw new NotFoundException('Venue not found');
    this.tenant.assertOrganization(venue.organizationId);
    return {
      venue: {
        id: venue.id,
        name: venue.name,
        slug: venue.slug,
        organizationId: venue.organizationId,
        totalCapacity: venue.totalCapacity,
      },
      layout: (venue.layouts[0] as ActiveLayoutWithRelations | undefined) ?? null,
    };
  }
}
