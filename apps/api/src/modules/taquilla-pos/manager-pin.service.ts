import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import { AuditService } from '../../common/audit.service';
import { TenantContextService } from '../../common/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { PosAccessService } from './pos-access.service';
import { asOrgSettings } from './types';

@Injectable()
export class ManagerPinService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PosAccessService,
    private readonly audit: AuditService,
    private readonly tenant: TenantContextService,
  ) {}

  async setManagerPin(organizationId: string, pin: string, currentPin?: string) {
    const orgId = this.access.resolveOrganizationId(organizationId);
    const org = await this.access.loadOrgSettings(orgId);
    const settings = org.settings;

    if (settings.managerPinHash) {
      await this.assertManagerPin(orgId, currentPin);
    }

    if (!/^\d{4,8}$/.test(pin)) {
      throw new BadRequestException('PIN must be 4–8 digits');
    }

    const hash = this.hashPin(pin);
    const nextSettings = { ...settings, managerPinHash: hash };
    await this.prisma.organization.update({
      where: { id: orgId },
      data: { settings: nextSettings },
    });

    await this.audit.log({
      action: 'pos.manager_pin.set',
      entityType: 'Organization',
      entityId: orgId,
      organizationId: orgId,
      userId: this.tenant.current().userId,
    });

    return { ok: true as const };
  }

  async verifyManagerPin(organizationId: string, pin: string) {
    const orgId = this.access.resolveOrganizationId(organizationId);
    await this.assertManagerPin(orgId, pin);
    return { ok: true as const };
  }

  async assertManagerPin(organizationId: string, pin?: string): Promise<void> {
    this.tenant.assertOrganization(organizationId);
    const org = await this.prisma.organization.findFirst({
      where: { id: organizationId },
      select: { settings: true },
    });
    if (!org) throw new BadRequestException('Organization not found');

    const settings = asOrgSettings(org.settings);
    if (!settings.managerPinHash) {
      throw new BadRequestException(
        'Manager PIN is not configured for this organization',
      );
    }
    if (!pin) {
      throw new ForbiddenException('PIN de gerente requerido');
    }

    const actual = Buffer.from(this.hashPin(pin), 'hex');
    const expected = Buffer.from(settings.managerPinHash, 'hex');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new ForbiddenException('PIN de gerente inválido');
    }
  }

  private hashPin(pin: string): string {
    return createHash('sha256').update(`boletera-mgr:${pin}`).digest('hex');
  }
}
