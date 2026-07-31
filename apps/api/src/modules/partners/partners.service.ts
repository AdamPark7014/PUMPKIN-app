import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { AuditService } from '../../common/audit.service';
import { TenantContextService } from '../../common/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateApiKeyDto } from './partners.dto';

@Injectable()
export class PartnersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tenant: TenantContextService,
  ) {}

  private hashKey(raw: string) {
    return createHash('sha256').update(raw).digest('hex');
  }

  private resolveOrganizationId(orgId: string): string {
    this.tenant.assertOrganization(orgId);
    return orgId;
  }

  async createApiKey(orgId: string, data: CreateApiKeyDto, createdById?: string) {
    const organizationId = this.resolveOrganizationId(orgId);
    if (!data.name?.trim()) {
      throw new BadRequestException('El nombre de la API key es obligatorio');
    }

    const raw = `blk_${randomBytes(24).toString('hex')}`;
    const keyPrefix = raw.slice(0, 12);
    const expiresAt = data.expiresInDays
      ? new Date(Date.now() + data.expiresInDays * 24 * 60 * 60 * 1000)
      : undefined;

    const apiKey = await this.prisma.apiKey.create({
      data: {
        organizationId,
        name: data.name.trim(),
        keyHash: this.hashKey(raw),
        keyPrefix,
        scopes: data.scopes ?? ['read:events', 'read:inventory', 'write:orders'],
        rateLimit: data.rateLimit ?? 1000,
        expiresAt,
        createdById,
      },
    });

    await this.audit.log({
      action: 'API_KEY_CREATED',
      entityType: 'ApiKey',
      entityId: apiKey.id,
      organizationId,
      userId: createdById ?? this.tenant.current().userId,
      metadata: { name: data.name, keyPrefix },
    });

    return {
      id: apiKey.id,
      name: apiKey.name,
      keyPrefix: apiKey.keyPrefix,
      scopes: apiKey.scopes,
      rateLimit: apiKey.rateLimit,
      expiresAt: apiKey.expiresAt,
      /** Shown once — store securely */
      secret: raw,
    };
  }

  async listApiKeys(orgId: string, page?: number, limit?: number) {
    const organizationId = this.resolveOrganizationId(orgId);
    const safeLimit = limit == null ? undefined : Math.min(100, Math.max(1, limit));
    const safePage = Math.max(1, page ?? 1);
    const skip = safeLimit == null ? undefined : (safePage - 1) * safeLimit;

    return this.prisma.apiKey.findMany({
      where: { organizationId },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        scopes: true,
        rateLimit: true,
        lastUsedAt: true,
        expiresAt: true,
        active: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: safeLimit,
    });
  }

  async revokeApiKey(orgId: string, keyId: string, actorId?: string) {
    const organizationId = this.resolveOrganizationId(orgId);
    const key = await this.prisma.apiKey.findFirst({
      where: { id: keyId, organizationId },
    });
    if (!key) throw new NotFoundException('API key no encontrada');

    const updated = await this.prisma.apiKey.update({
      where: { id: key.id },
      data: { active: false },
    });

    await this.audit.log({
      action: 'API_KEY_REVOKED',
      entityType: 'ApiKey',
      entityId: keyId,
      organizationId,
      userId: actorId ?? this.tenant.current().userId,
    });

    return updated;
  }

  async validateApiKey(rawKey: string) {
    if (!rawKey || typeof rawKey !== 'string' || !rawKey.startsWith('blk_')) {
      return null;
    }

    const hash = this.hashKey(rawKey);
    const key = await this.prisma.apiKey.findFirst({
      where: { keyHash: hash, active: true },
      include: { organization: { select: { id: true, slug: true, name: true } } },
    });
    if (!key) return null;
    if (key.expiresAt && key.expiresAt < new Date()) return null;

    // Defense-in-depth equality check even though lookup is by hash.
    const stored = Buffer.from(key.keyHash, 'utf8');
    const provided = Buffer.from(hash, 'utf8');
    if (stored.length !== provided.length || !timingSafeEqual(stored, provided)) {
      return null;
    }

    await this.prisma.apiKey.update({
      where: { id: key.id },
      data: { lastUsedAt: new Date() },
    });

    return key;
  }
}
