import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AuditService } from '../../common/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantScopeService } from '../tenant/tenant-scope.service';
import type {
  AuditQueryDto,
  InviteTeamMemberDto,
  TeamQueryDto,
  UpdateOrganizationDto,
  UpdateTeamMemberDto,
} from './dto/organization.dto';
import { isTeamRole, rankOf, TEAM_ROLES } from './team-roles';

const BCRYPT_ROUNDS = 12;

const ORG_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  type: true,
  website: true,
  logoUrl: true,
  bannerUrl: true,
  email: true,
  phone: true,
  country: true,
  timezone: true,
  currency: true,
  city: true,
  state: true,
  verified: true,
  verifiedAt: true,
  commissionRate: true,
  feesInclusive: true,
  allowResale: true,
  resaleCommission: true,
  createdAt: true,
  updatedAt: true,
  tenantTheme: {
    select: {
      id: true,
      organizationId: true,
      primaryColor: true,
      secondaryColor: true,
      logoUrl: true,
      faviconUrl: true,
      subdomain: true,
      customDomain: true,
    },
  },
  _count: { select: { events: true, venues: true, users: true, orders: true } },
} satisfies Prisma.OrganizationSelect;

const TEAM_MEMBER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  active: true,
  lastLogin: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

const AUDIT_SELECT = {
  id: true,
  action: true,
  entityType: true,
  entityId: true,
  userId: true,
  metadata: true,
  createdAt: true,
} satisfies Prisma.AuditEventSelect;

type OrgRow = Prisma.OrganizationGetPayload<{ select: typeof ORG_SELECT }>;

@Injectable()
export class OrganizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: TenantScopeService,
  ) {}

  async getOrganization(requestedOrgId: string) {
    const organizationId = this.scope.resolve(requestedOrgId);
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: ORG_SELECT,
    });
    if (!organization) throw new NotFoundException('Organization not found');
    return organization;
  }

  async updateOrganization(requestedOrgId: string, data: UpdateOrganizationDto) {
    const organizationId = this.scope.resolve(requestedOrgId);
    await this.requireOrganization(organizationId);

    if (
      !this.scope.isPrivileged() &&
      (data.commissionRate !== undefined || data.feesInclusive !== undefined)
    ) {
      throw new ForbiddenException(
        'commissionRate and feesInclusive can only be changed by platform operators',
      );
    }

    const patch: Prisma.OrganizationUpdateInput = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.description !== undefined) patch.description = data.description;
    if (data.website !== undefined) patch.website = data.website;
    if (data.email !== undefined) patch.email = data.email;
    if (data.phone !== undefined) patch.phone = data.phone;
    if (data.allowResale !== undefined) patch.allowResale = data.allowResale;
    if (data.commissionRate !== undefined) patch.commissionRate = data.commissionRate;
    if (data.feesInclusive !== undefined) patch.feesInclusive = data.feesInclusive;

    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('No updatable fields provided');
    }

    const organization = await this.prisma.organization.update({
      where: { id: organizationId },
      data: patch,
      select: ORG_SELECT,
    });

    await this.audit.log({
      action: 'ORG_UPDATED',
      entityType: 'Organization',
      entityId: organizationId,
      organizationId,
      userId: this.scope.actorId(),
      metadata: this.auditMetadata(patch),
    });

    return organization;
  }

  async listTeam(requestedOrgId: string, query: TeamQueryDto = {}) {
    const organizationId = this.scope.resolve(requestedOrgId);
    const limit = Math.min(Math.max(query.limit ?? 200, 1), 200);

    return this.prisma.user.findMany({
      where: { organizationId, role: { in: [...TEAM_ROLES] } },
      select: TEAM_MEMBER_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      ...(query.cursor
        ? { skip: 1, cursor: { id: query.cursor } }
        : {}),
    });
  }

  async inviteTeamMember(requestedOrgId: string, data: InviteTeamMemberDto) {
    const organizationId = this.scope.resolve(requestedOrgId);
    await this.requireOrganization(organizationId);
    const actor = await this.requireActor();

    if (!isTeamRole(data.role)) {
      throw new BadRequestException('Invalid team role');
    }
    this.assertAssignableRole(actor.role, data.role);

    const email = data.email.trim().toLowerCase();
    const exists = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (exists) throw new ConflictException('Email already registered');

    const hash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    const user = await this.prisma.user.create({
      data: {
        email,
        password: hash,
        firstName: data.firstName.trim(),
        lastName: data.lastName.trim(),
        role: data.role,
        organizationId,
        provider: 'email',
        active: true,
      },
      select: TEAM_MEMBER_SELECT,
    });

    await this.audit.log({
      action: 'TEAM_MEMBER_INVITED',
      entityType: 'User',
      entityId: user.id,
      organizationId,
      userId: actor.id,
      metadata: { email, role: data.role },
    });

    return user;
  }

  async updateTeamMember(
    requestedOrgId: string,
    userId: string,
    data: UpdateTeamMemberDto,
  ) {
    const organizationId = this.scope.resolve(requestedOrgId);
    const actor = await this.requireActor();
    if (data.role === undefined && data.active === undefined) {
      throw new BadRequestException('No updatable fields provided');
    }
    if (data.role !== undefined) {
      if (!isTeamRole(data.role)) throw new BadRequestException('Invalid team role');
      this.assertAssignableRole(actor.role, data.role);
    }

    const user = await this.prisma.user.findFirst({
      where: { id: userId, organizationId },
      select: { id: true, role: true, active: true },
    });
    if (!user) throw new NotFoundException('Team member not found');

    if (user.role === UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Cannot modify a platform operator via tenant team APIs');
    }
    if (!isTeamRole(user.role)) {
      throw new ForbiddenException('Target user is outside the managed team role set');
    }

    this.assertCanManage(actor.role, user.role);
    if (userId === actor.id) {
      if (data.role !== undefined && data.role !== user.role) {
        throw new ForbiddenException('Cannot change your own role');
      }
      if (data.active === false) {
        throw new ForbiddenException('Cannot deactivate your own account');
      }
    }

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        ...(data.role !== undefined ? { role: data.role } : {}),
        ...(data.active !== undefined ? { active: data.active } : {}),
      },
      select: TEAM_MEMBER_SELECT,
    });

    await this.audit.log({
      action: 'TEAM_MEMBER_UPDATED',
      entityType: 'User',
      entityId: userId,
      organizationId,
      userId: actor.id,
      metadata: {
        ...(data.role !== undefined ? { role: data.role } : {}),
        ...(data.active !== undefined ? { active: data.active } : {}),
      },
    });

    return updated;
  }

  async getAuditLog(requestedOrgId: string, query: AuditQueryDto = {}) {
    const organizationId = this.scope.resolve(requestedOrgId);
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);

    return this.prisma.auditEvent.findMany({
      where: {
        organizationId,
        ...(query.action ? { action: query.action } : {}),
      },
      select: AUDIT_SELECT,
      take: limit,
      ...(query.cursor ? { skip: 1, cursor: { id: query.cursor } } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  async getSaasCapabilities(requestedOrgId?: string) {
    const organizationId = this.scope.resolve(requestedOrgId);
    const organization = await this.requireOrganization(organizationId);

    const [events, terminals, apiKeys, waitlist, transfers, payouts] =
      await Promise.all([
        this.prisma.event.count({ where: { organizationId } }),
        this.prisma.posTerminal.count({ where: { organizationId } }),
        this.prisma.apiKey.count({ where: { organizationId, active: true } }),
        this.prisma.waitlistEntry.count({
          where: { event: { organizationId }, status: 'PENDING' },
        }),
        this.prisma.ticketTransfer.count({
          where: { ticket: { event: { organizationId } } },
        }),
        this.prisma.promoterPayout.count({ where: { organizationId } }),
      ]);

    return {
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        verified: organization.verified,
      },
      metrics: {
        events,
        terminals,
        apiKeys,
        waitlistPending: waitlist,
        transfers,
        payouts,
      },
      modules: {
        multiTenant: true,
        seatMaps: true,
        posTaquilla: terminals > 0,
        resale: organization.allowResale,
        dynamicPricing: true,
        fraud: true,
        campaigns: true,
        channels: true,
        reporting: true,
        waitlist: true,
        ticketTransfer: true,
        apiPartners: true,
        auditLog: true,
        teamManagement: true,
        banortePayments: true,
        settlements: payouts > 0,
        cfdiSandbox: true,
        partnerApiKeys: true,
      },
      roadmap: [
        {
          id: 'cfdi',
          label: 'Facturación CFDI 4.0',
          status: 'partial',
          priority: 'high',
          note: 'Sandbox stamp live; PAC production pending',
        },
        {
          id: 'sso',
          label: 'SSO Google / Microsoft',
          status: 'partial',
          priority: 'high',
          note: 'OAuth wired; set GOOGLE_* / MICROSOFT_* env',
        },
        {
          id: 'season',
          label: 'Abonos y temporadas',
          status: 'partial',
          priority: 'medium',
          note: 'CRUD + purchase demo',
        },
        {
          id: 'mobile',
          label: 'Scanner PWA offline',
          status: 'partial',
          priority: 'medium',
          note: 'Admin scanner queues offline scans',
        },
        {
          id: 'banorte-prod',
          label: 'Banorte Payworks producción + refunds API',
          status: 'partial',
          priority: 'high',
        },
        {
          id: 'settlements',
          label: 'Liquidaciones SPEI a promotor',
          status: 'partial',
          priority: 'high',
          note: 'PromoterPayout list + mark paid; bank rail pending',
        },
        {
          id: 'channels',
          label: 'Cuotas de canal enforced',
          status: 'done',
          priority: 'high',
        },
      ],
    };
  }

  private async requireOrganization(organizationId: string): Promise<OrgRow> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: ORG_SELECT,
    });
    if (!organization) throw new NotFoundException('Organization not found');
    return organization;
  }

  /** Roles strictly above the actor are forbidden; peers remain assignable. */
  private assertAssignableRole(actorRole: UserRole, role: UserRole): void {
    if (actorRole === UserRole.SUPER_ADMIN) return;
    if (rankOf(role) > rankOf(actorRole)) {
      throw new ForbiddenException('Cannot assign a role above your own');
    }
  }

  private assertCanManage(actorRole: UserRole, targetRole: UserRole): void {
    if (actorRole === UserRole.SUPER_ADMIN) return;
    if (rankOf(targetRole) > rankOf(actorRole)) {
      throw new ForbiddenException('Cannot manage a superior team member');
    }
  }

  private async requireActor(): Promise<{ id: string; role: UserRole }> {
    const userId = this.scope.actorId();
    if (!userId) throw new ForbiddenException('Authentication required');
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!user) throw new ForbiddenException('Authentication required');
    return user;
  }

  private auditMetadata(
    patch: Prisma.OrganizationUpdateInput,
  ): Record<string, unknown> {
    const metadata: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) metadata[key] = value;
    }
    return metadata;
  }
}
