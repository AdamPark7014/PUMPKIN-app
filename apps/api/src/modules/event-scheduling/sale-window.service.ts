import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { SalePhaseStatus, SalesChannel } from '@prisma/client';
import {
  resolveSaleStatus,
  SALE_STATE_LABELS,
  type SaleStatus,
} from '@boletera/shared';
import { TenantContextService } from '../../common/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';

export interface PurchaseContext {
  channel?: SalesChannel;
  /** Presale / member code supplied by the buyer. */
  code?: string | null;
  /** Optional organization scope when the caller is tenant-bound. */
  organizationId?: string;
}

/**
 * Single authority for "can this event be sold right now?".
 *
 * Inventory holds, POS sales and order creation all go through here so a
 * scheduled on-sale time is enforced everywhere instead of only in the UI.
 */
@Injectable()
export class SaleWindowService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly tenant?: TenantContextService,
  ) {}

  private async load(eventId: string, organizationId?: string) {
    const event = await this.prisma.event.findFirst({
      where: {
        id: eventId,
        ...(organizationId ? { organizationId } : {}),
      },
      select: {
        id: true,
        organizationId: true,
        title: true,
        status: true,
        startsAt: true,
        endsAt: true,
        timezone: true,
        announceAt: true,
        publishAt: true,
        salesStartAt: true,
        salesEndAt: true,
        salePhases: {
          where: { status: { not: SalePhaseStatus.CANCELLED } },
          orderBy: { priority: 'asc' },
        },
      },
    });
    if (!event) throw new NotFoundException('Evento no encontrado');
    return event;
  }

  /**
   * Public storefront lookup remains ID-based (no auth). When a tenant context
   * is present, the organization scope is enforced before returning status.
   */
  async getStatus(eventId: string, now = new Date()) {
    const ctx = this.tenant?.current();
    const organizationId =
      ctx && !ctx.privileged && ctx.organizationId
        ? ctx.organizationId
        : undefined;
    const event = await this.load(eventId, organizationId);
    if (ctx?.organizationId) {
      this.tenant?.assertOrganization(event.organizationId);
    }

    const status = resolveSaleStatus(
      {
        status: event.status,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        announceAt: event.announceAt,
        publishAt: event.publishAt,
        salesStartAt: event.salesStartAt,
        salesEndAt: event.salesEndAt,
        phases: event.salePhases.map((phase) => ({
          id: phase.id,
          name: phase.name,
          kind: phase.kind,
          startsAt: phase.startsAt,
          endsAt: phase.endsAt,
          code: phase.code,
        })),
      },
      now,
    );
    return { ...status, label: SALE_STATE_LABELS[status.state] };
  }

  /**
   * Throws unless the event can be sold through `context.channel` right now.
   * A valid presale code unlocks a gated phase; ADMIN keeps a manual override.
   */
  async assertPurchasable(eventId: string, context: PurchaseContext = {}) {
    const channel = context.channel ?? SalesChannel.WEB;
    if (channel === SalesChannel.ADMIN) {
      return { state: 'ON_SALE' as const, override: true, phaseId: null as string | null };
    }

    const ctx = this.tenant?.current();
    const organizationId =
      context.organizationId ??
      (ctx && !ctx.privileged ? ctx.organizationId : undefined);
    const event = await this.load(eventId, organizationId);
    if (organizationId || ctx?.organizationId) {
      this.tenant?.assertOrganization(event.organizationId);
    }

    const phases = event.salePhases.map((phase) => ({
      id: phase.id,
      name: phase.name,
      kind: phase.kind,
      startsAt: phase.startsAt,
      endsAt: phase.endsAt,
      code: phase.code,
    }));
    const status = resolveSaleStatus(
      {
        status: event.status,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        announceAt: event.announceAt,
        publishAt: event.publishAt,
        salesStartAt: event.salesStartAt,
        salesEndAt: event.salesEndAt,
        phases,
      },
      new Date(),
    );

    const channelAllowed = (phaseId?: string) => {
      if (!phaseId) return true;
      const phase = event.salePhases.find((item) => item.id === phaseId);
      if (!phase || !phase.channels.length) return true;
      return phase.channels.includes(channel);
    };

    if (status.canPurchase) {
      if (!channelAllowed(status.activePhase?.id)) {
        throw new ForbiddenException(
          `La fase "${status.activePhase?.name}" no está habilitada para el canal ${channel}`,
        );
      }
      return {
        state: status.state,
        override: false,
        phaseId: status.activePhase?.id ?? null,
      };
    }

    const code = context.code?.trim().toUpperCase();
    if (code) {
      const unlocked = status.gatedPhases.find(
        (phase) => phase.code?.toUpperCase() === code,
      );
      if (unlocked && channelAllowed(unlocked.id)) {
        return {
          state: 'PRESALE' as const,
          override: false,
          phaseId: unlocked.id ?? null,
        };
      }
      if (unlocked) {
        throw new ForbiddenException(
          `El código "${code}" no aplica para el canal ${channel}`,
        );
      }
      throw new ForbiddenException('Código de preventa inválido o expirado');
    }

    throw new ForbiddenException({
      message: this.messageFor(status),
      saleState: status.state,
      reason: status.reason,
      nextChangeAt: status.nextChangeAt ?? null,
      requiresCode: status.gatedPhases.length > 0,
    });
  }

  private messageFor(status: SaleStatus): string {
    switch (status.reason) {
      case 'DRAFT':
        return 'El evento aún no está publicado';
      case 'NOT_YET_ON_SALE':
        return status.gatedPhases.length
          ? 'La venta general no ha abierto: se requiere código de preventa'
          : status.nextChangeAt
            ? `La venta abre el ${new Date(status.nextChangeAt).toISOString()}`
            : 'La venta aún no ha abierto';
      case 'SALES_CLOSED':
        return 'La venta para este evento ya cerró';
      case 'EVENT_CANCELLED':
        return 'El evento fue cancelado';
      case 'EVENT_FINISHED':
        return 'El evento ya finalizó';
      default:
        return 'El evento no está disponible para venta';
    }
  }
}
