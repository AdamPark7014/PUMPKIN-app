import { Injectable } from '@nestjs/common';
import { PosTerminalStatus, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { TenantContextService } from '../../common/tenant-context.service';
import { InventoryService } from '../inventory/inventory.service';
import { PrismaService } from '../prisma/prisma.service';
import { PosAccessService } from './pos-access.service';

@Injectable()
export class TerminalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PosAccessService,
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
    private readonly tenant: TenantContextService,
  ) {}

  async initializeTerminal(data: {
    organizationId: string;
    locationName: string;
    terminalName: string;
    hardwareConfig?: Record<string, string>;
  }) {
    const organizationId = this.access.resolveOrganizationId(data.organizationId);

    const existing = await this.prisma.posTerminal.findFirst({
      where: {
        organizationId,
        locationName: data.locationName,
        status: PosTerminalStatus.READY,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      this.tenant.assertOrganization(existing.organizationId);
      return existing;
    }

    const terminal = await this.prisma.posTerminal.create({
      data: {
        organizationId,
        name: data.terminalName,
        locationName: data.locationName,
        status: PosTerminalStatus.READY,
        hardwareConfig: (data.hardwareConfig ?? {}) as Prisma.InputJsonValue,
        lastSyncAt: new Date(),
      },
    });

    await this.audit.log({
      action: 'pos.terminal.init',
      entityType: 'PosTerminal',
      entityId: terminal.id,
      organizationId,
      userId: this.tenant.current().userId,
      metadata: { locationName: data.locationName, name: data.terminalName },
    });

    return terminal;
  }

  async syncInventory(terminalId: string, eventId: string) {
    const terminal = await this.access.requireTerminal(terminalId);
    const event = await this.access.requireEvent(eventId, terminal.organizationId);
    const availability = await this.inventory.getAvailability(event.id);

    await this.prisma.posTerminal.update({
      where: { id: terminal.id },
      data: {
        lastSyncAt: new Date(),
        cacheMetadata: JSON.parse(JSON.stringify(availability)) as Prisma.InputJsonValue,
      },
    });

    return availability;
  }

  async enableOfflineMode(terminalId: string) {
    const terminal = await this.access.requireTerminal(terminalId);
    await this.prisma.posTerminal.update({
      where: { id: terminal.id },
      data: { offlineMode: true, status: PosTerminalStatus.OFFLINE },
    });

    await this.audit.log({
      action: 'pos.terminal.offline_enable',
      entityType: 'PosTerminal',
      entityId: terminal.id,
      organizationId: terminal.organizationId,
      userId: this.tenant.current().userId,
    });

    return { mode: 'OFFLINE' as const, status: 'QUEUED' as const };
  }
}
