import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantScopeService } from './tenant-scope.service';
import type { ResolvedTenant } from './tenant.types';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '::']);
const HOSTNAME_PATTERN = /^[a-z0-9._:-]{1,253}$/;
/** Must match seed-v2 platform org (`packages/database/scripts/seed.ts`). */
const DEFAULT_DEMO_SLUG = 'boletera-plataforma';

/** Orgs included in the local marketplace cartellera (loopback Host). */
const LOCAL_MARKETPLACE_SLUGS = [
  'boletera-plataforma',
  'ocesa-live',
  'cie-espectaculos',
  'teatro-nacional-mx',
] as const;

/** Public storefront projection: never expose banking, fiscal or settings data. */
const TENANT_SELECT = {
  id: true,
  name: true,
  slug: true,
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
} satisfies Prisma.OrganizationSelect;

@Injectable()
export class TenantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: TenantScopeService,
  ) {}

  async resolveByHost(host: string): Promise<ResolvedTenant> {
    const hostname = this.normalizeHost(host);
    if (!hostname || !HOSTNAME_PATTERN.test(hostname)) {
      throw new BadRequestException('Invalid host');
    }

    const tenant = await this.lookup(hostname);
    if (!tenant) throw new NotFoundException('Tenant not found');

    this.scope.assertAnonymousOrOwn(tenant.id);
    return tenant;
  }

  /**
   * Organization IDs visible on the public storefront for this Host.
   * Loopback aggregates the seed marketplace so local cartelera is not empty.
   */
  async discoveryOrgIds(host: string): Promise<string[]> {
    const primary = await this.resolveByHost(host);
    const hostname = this.normalizeHost(host);
    if (!LOOPBACK_HOSTS.has(hostname)) return [primary.id];

    // Modo tenant fijo (evento único): con DEMO_TENANT_SLUG explícito, el
    // marketplace local se limita a ese tenant en vez de mezclar las orgs de
    // demo. Sin la variable, el comportamiento demo queda intacto.
    if (process.env.DEMO_TENANT_SLUG?.trim()) return [primary.id];

    const rows = await this.prisma.organization.findMany({
      where: { slug: { in: [...LOCAL_MARKETPLACE_SLUGS] } },
      select: { id: true },
    });
    const ids = rows.map((row) => row.id);
    return ids.length > 0 ? ids : [primary.id];
  }

  private async lookup(hostname: string): Promise<ResolvedTenant | null> {
    if (LOOPBACK_HOSTS.has(hostname)) return this.demoTenant();

    const labels = hostname.split('.');
    if (labels[0] === 'www') labels.shift();
    const subdomain = labels[0];
    if (!subdomain || subdomain === 'localhost') return this.demoTenant();

    const byTheme = await this.prisma.tenantTheme.findFirst({
      where: { OR: [{ subdomain }, { customDomain: hostname }] },
      select: { organization: { select: TENANT_SELECT } },
    });
    if (byTheme) return byTheme.organization;

    return this.prisma.organization.findUnique({
      where: { slug: subdomain },
      select: TENANT_SELECT,
    });
  }

  /**
   * Local development entry point. There is deliberately no "first organization
   * in the table" fallback: on an unmatched host that would hand an arbitrary
   * tenant's identity to the caller.
   */
  private demoTenant(): Promise<ResolvedTenant | null> {
    const slug = process.env.DEMO_TENANT_SLUG?.trim() || DEFAULT_DEMO_SLUG;
    return this.prisma.organization.findUnique({
      where: { slug },
      select: TENANT_SELECT,
    });
  }

  private normalizeHost(host: string): string {
    const value = host.trim().toLowerCase();
    const bracketed = /^\[(.+)\](?::\d{1,5})?$/.exec(value);
    if (bracketed) return bracketed[1];

    const colons = value.split(':').length - 1;
    if (colons === 1) {
      const [name, port] = value.split(':');
      if (/^\d{1,5}$/.test(port)) return name.replace(/\.$/, '');
    }
    return value.replace(/\.$/, '');
  }
}
