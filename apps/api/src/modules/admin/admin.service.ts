import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type PayoutStatus } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { TenantContextService } from '../../common/tenant-context.service';
import { NotificationService } from '../notification/notification.service';
import { PaymentService } from '../payment/payment.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  AdminPagedQueryDto,
  AdminSalesReportQueryDto,
  CancelOrderDto,
  CompletePayoutDto,
  CreateVenueDto,
  ProcessPayoutDto,
  RefundOrderDto,
  SuggestLayoutDto,
  UpdateBrandingDto,
} from './dto/admin.dto';

const EVENT_LIST_SELECT = {
  id: true,
  title: true,
  slug: true,
  status: true,
  startsAt: true,
  endsAt: true,
  timezone: true,
  totalCapacity: true,
  venueId: true,
  organizationId: true,
  publishedAt: true,
  createdAt: true,
  metadata: true,
  venue: { select: { id: true, name: true, city: true } },
  _count: { select: { orders: true, tickets: true } },
} satisfies Prisma.EventSelect;

const VENUE_LIST_SELECT = {
  id: true,
  name: true,
  slug: true,
  city: true,
  state: true,
  country: true,
  timezone: true,
  totalCapacity: true,
  organizationId: true,
  layouts: {
    where: { isActive: true },
    select: { id: true, version: true, updatedAt: true },
    take: 1,
  },
  _count: { select: { events: true } },
} satisfies Prisma.VenueSelect;

const ORDER_LIST_SELECT = {
  id: true,
  publicId: true,
  status: true,
  channel: true,
  totalAmount: true,
  currency: true,
  buyerName: true,
  buyerEmail: true,
  createdAt: true,
  event: { select: { title: true, slug: true } },
  payment: { select: { status: true, gateway: true } },
} satisfies Prisma.OrderSelect;

const ORDER_DETAIL_SELECT = {
  id: true,
  publicId: true,
  organizationId: true,
  status: true,
  channel: true,
  buyerEmail: true,
  buyerName: true,
  buyerPhone: true,
  billingAddress: true,
  subtotal: true,
  fees: true,
  discountAmount: true,
  taxAmount: true,
  totalAmount: true,
  currency: true,
  commissionAmount: true,
  paymentMethod: true,
  cashierId: true,
  expiresAt: true,
  completedAt: true,
  refundedAt: true,
  createdAt: true,
  updatedAt: true,
  event: { select: { id: true, title: true, slug: true } },
  payment: {
    select: {
      id: true,
      gateway: true,
      status: true,
      externalId: true,
      amount: true,
      currency: true,
      method: true,
      lastFourDigits: true,
      brand: true,
      errorMessage: true,
      processedAt: true,
      createdAt: true,
    },
  },
  refunds: {
    orderBy: { requestedAt: 'desc' as const },
    select: {
      id: true,
      amount: true,
      status: true,
      reason: true,
      notes: true,
      requestedBy: true,
      processedBy: true,
      requestedAt: true,
      processedAt: true,
    },
  },
  items: {
    select: {
      id: true,
      quantity: true,
      unitPrice: true,
      subtotal: true,
      tickets: {
        select: {
          id: true,
          code: true,
          status: true,
          section: true,
          row: true,
          seatNumber: true,
        },
      },
    },
  },
  fraudFlags: {
    select: {
      id: true,
      type: true,
      severity: true,
      score: true,
      reason: true,
      status: true,
      orderId: true,
      createdAt: true,
      resolvedAt: true,
      resolution: true,
    },
  },
} satisfies Prisma.OrderSelect;

const THEME_SELECT = {
  id: true,
  organizationId: true,
  primaryColor: true,
  secondaryColor: true,
  logoUrl: true,
  faviconUrl: true,
  subdomain: true,
  customDomain: true,
} satisfies Prisma.TenantThemeSelect;

const PAYOUT_SELECT = {
  id: true,
  organizationId: true,
  periodStart: true,
  periodEnd: true,
  grossRevenue: true,
  commission: true,
  netAmount: true,
  status: true,
  method: true,
  referenceId: true,
  processedAt: true,
  createdAt: true,
} satisfies Prisma.PromoterPayoutSelect;

type OrderDetail = Prisma.OrderGetPayload<{ select: typeof ORDER_DETAIL_SELECT }>;

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
    private readonly tenant: TenantContextService,
  ) {}

  async dashboard(requestedOrgId?: string) {
    const organizationId = this.tenant.resolveOrganization(requestedOrgId);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      ordersToday,
      activeEvents,
      activeHolds,
      dailyRevenue,
      fraudFlags,
      totalUsers,
      taquillaTerminals,
      channelBreakdown,
    ] = await Promise.all([
      this.prisma.order.count({
        where: {
          organizationId,
          createdAt: { gte: today },
          status: 'COMPLETED',
        },
      }),
      this.prisma.event.count({
        where: { organizationId, status: 'SCHEDULED' },
      }),
      this.prisma.ticket.count({
        where: { event: { organizationId }, status: 'HELD' },
      }),
      this.prisma.order.aggregate({
        where: {
          organizationId,
          status: 'COMPLETED',
          createdAt: { gte: today },
        },
        _sum: { totalAmount: true },
      }),
      this.prisma.fraudFlag.count({
        where: { order: { organizationId }, status: 'FLAGGED' },
      }),
      this.prisma.user.count({ where: { organizationId } }),
      this.prisma.posTerminal.count({ where: { organizationId } }),
      this.prisma.order.groupBy({
        by: ['channel'],
        where: {
          organizationId,
          status: 'COMPLETED',
          createdAt: { gte: today },
        },
        _sum: { totalAmount: true },
        _count: true,
      }),
    ]);

    return {
      ordersToday,
      activeEvents,
      activeHolds,
      revenueToday: Number(dailyRevenue._sum.totalAmount ?? 0),
      fraudFlags,
      totalUsers,
      taquillaTerminals,
      channelBreakdown: channelBreakdown.map((row) => ({
        channel: row.channel,
        orders: row._count,
        revenue: Number(row._sum.totalAmount ?? 0),
      })),
      timestamp: new Date(),
    };
  }

  async platformOverview(requestedOrgId?: string) {
    const organizationId = this.tenant.resolveOrganization(requestedOrgId);
    const [dashboard, events, venues, salesByChannel, recentOrders] =
      await Promise.all([
        this.dashboard(organizationId),
        this.prisma.event.count({ where: { organizationId } }),
        this.prisma.venue.count({ where: { organizationId } }),
        this.salesReport(organizationId),
        this.prisma.order.findMany({
          where: { organizationId },
          orderBy: { createdAt: 'desc' },
          take: 8,
          select: {
            publicId: true,
            status: true,
            channel: true,
            totalAmount: true,
            createdAt: true,
            event: { select: { title: true } },
          },
        }),
      ]);

    return {
      ...dashboard,
      totalEvents: events,
      totalVenues: venues,
      salesByChannel,
      recentOrders: recentOrders.map((order) => ({
        publicId: order.publicId,
        status: order.status,
        channel: order.channel,
        totalAmount: String(order.totalAmount),
        eventTitle: order.event.title,
        createdAt: order.createdAt,
      })),
    };
  }

  async listEvents(requestedOrgId?: string, query: AdminPagedQueryDto = {}) {
    const organizationId = this.tenant.resolveOrganization(requestedOrgId);
    // Default 200 matches the previous "return the catalog" contract for typical tenants.
    const limit = this.pageSize(query.limit, 200);
    return this.prisma.event.findMany({
      where: { organizationId },
      orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
      take: limit,
      ...(query.cursor ? { skip: 1, cursor: { id: query.cursor } } : {}),
      select: EVENT_LIST_SELECT,
    });
  }

  async listVenues(requestedOrgId?: string, query: AdminPagedQueryDto = {}) {
    const organizationId = this.tenant.resolveOrganization(requestedOrgId);
    const limit = this.pageSize(query.limit, 200);
    return this.prisma.venue.findMany({
      where: { organizationId },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: limit,
      ...(query.cursor ? { skip: 1, cursor: { id: query.cursor } } : {}),
      select: VENUE_LIST_SELECT,
    });
  }

  async createVenue(requestedOrgId: string | undefined, data: CreateVenueDto) {
    const organizationId = this.tenant.resolveOrganization(requestedOrgId);
    const name = data.name.trim();
    if (!name) throw new BadRequestException('El nombre del venue es obligatorio');

    const baseSlug =
      name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 48) || 'venue';

    // Venue.slug is globally unique in the schema.
    let slug = baseSlug;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const exists = await this.prisma.venue.findUnique({
        where: { slug },
        select: { id: true },
      });
      if (!exists) break;
      slug = `${baseSlug}-${attempt + 2}`;
    }

    const emptyMap: Prisma.InputJsonValue = {
      version: 3,
      viewport: { width: 800, height: 500 },
      sections: [],
      venue: {
        stage: { x: 400, y: 60, width: 220, depth: 0, elevation: 0 },
        levels: [{ id: 'floor', name: 'Planta', zIndex: 0, elevation: 0 }],
      },
    };

    const venue = await this.prisma.venue.create({
      data: {
        organizationId,
        name,
        slug,
        description: 'Mapa creado desde el estudio 3D',
        address: data.address?.trim() || 'Por definir',
        city: data.city?.trim() || 'Ciudad de México',
        state: data.state?.trim() || 'CDMX',
        country: data.country?.trim() || 'MX',
        timezone: data.timezone?.trim() || 'America/Mexico_City',
        totalCapacity: data.totalCapacity ?? 0,
        layouts: {
          create: {
            name: 'Layout principal',
            mapData: emptyMap,
            isActive: true,
          },
        },
      },
      select: {
        id: true,
        name: true,
        slug: true,
        city: true,
        totalCapacity: true,
        layouts: {
          where: { isActive: true },
          select: { id: true },
          take: 1,
        },
      },
    });

    await this.audit.log({
      action: 'VENUE_CREATED',
      entityType: 'Venue',
      entityId: venue.id,
      organizationId,
      userId: this.tenant.current().userId,
      metadata: { name: venue.name, slug: venue.slug, template: data.template ?? 'blank' },
    });

    return {
      id: venue.id,
      name: venue.name,
      slug: venue.slug,
      city: venue.city,
      totalCapacity: venue.totalCapacity,
      layoutId: venue.layouts[0]?.id ?? null,
      template: data.template ?? 'blank',
    };
  }

  async getTheme(requestedOrgId?: string) {
    const organizationId = this.tenant.resolveOrganization(requestedOrgId);
    const theme = await this.prisma.tenantTheme.findUnique({
      where: { organizationId },
      select: THEME_SELECT,
    });
    return (
      theme ?? {
        primaryColor: '#171717',
        subdomain: 'demo',
      }
    );
  }

  async updateTheme(requestedOrgId: string | undefined, data: UpdateBrandingDto) {
    const organizationId = this.tenant.resolveOrganization(requestedOrgId);
    if (
      data.primaryColor === undefined &&
      data.logoUrl === undefined &&
      data.subdomain === undefined
    ) {
      throw new BadRequestException('No branding fields provided');
    }

    if (data.subdomain) {
      const clash = await this.prisma.tenantTheme.findFirst({
        where: {
          subdomain: data.subdomain,
          NOT: { organizationId },
        },
        select: { organizationId: true },
      });
      if (clash) throw new BadRequestException('Subdomain already in use');
    }

    const theme = await this.prisma.tenantTheme.upsert({
      where: { organizationId },
      create: {
        organizationId,
        primaryColor: data.primaryColor ?? '#171717',
        logoUrl: data.logoUrl,
        subdomain: data.subdomain,
      },
      update: {
        ...(data.primaryColor !== undefined ? { primaryColor: data.primaryColor } : {}),
        ...(data.logoUrl !== undefined ? { logoUrl: data.logoUrl } : {}),
        ...(data.subdomain !== undefined ? { subdomain: data.subdomain } : {}),
      },
      select: THEME_SELECT,
    });

    await this.audit.log({
      action: 'BRANDING_UPDATED',
      entityType: 'TenantTheme',
      entityId: theme.id,
      organizationId,
      userId: this.tenant.current().userId,
      metadata: {
        ...(data.primaryColor !== undefined ? { primaryColor: data.primaryColor } : {}),
        ...(data.logoUrl !== undefined ? { logoUrl: data.logoUrl } : {}),
        ...(data.subdomain !== undefined ? { subdomain: data.subdomain } : {}),
      },
    });

    return theme;
  }

  async listOrders(requestedOrgId?: string, query: AdminPagedQueryDto = {}) {
    const organizationId = this.tenant.resolveOrganization(requestedOrgId);
    const limit = this.pageSize(query.limit);
    return this.prisma.order.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      ...(query.cursor ? { skip: 1, cursor: { id: query.cursor } } : {}),
      select: ORDER_LIST_SELECT,
    });
  }

  async getOrder(requestedOrgId: string | undefined, orderId: string): Promise<OrderDetail> {
    const organizationId = this.tenant.resolveOrganization(requestedOrgId);
    // Probe by id so a foreign tenant gets 403 (E2E authz), not a soft 404 —
    // without loading buyer/payment payload before the ownership check.
    const probe = await this.prisma.order.findFirst({
      where: { OR: [{ id: orderId }, { publicId: orderId }] },
      select: { id: true, organizationId: true },
    });
    if (!probe) throw new NotFoundException('Order not found');
    this.tenant.assertResourceOrganization(probe.organizationId, organizationId);

    return this.prisma.order.findFirstOrThrow({
      where: { id: probe.id, organizationId },
      select: ORDER_DETAIL_SELECT,
    });
  }

  async requestRefund(
    requestedOrgId: string | undefined,
    orderId: string,
    data: RefundOrderDto,
    requestedBy: string,
  ) {
    const order = await this.getOrder(requestedOrgId, orderId);
    const refund = await this.payments.createRefund({
      orderId: order.id,
      reason: data.reason || 'CUSTOMER_REQUEST',
      amount: data.amount,
      notes: data.notes,
      requestedBy,
    });

    await this.audit.log({
      action: 'ORDER_REFUND_REQUESTED',
      entityType: 'Order',
      entityId: order.id,
      organizationId: order.organizationId,
      userId: this.tenant.current().userId,
      metadata: {
        publicId: order.publicId,
        amount: data.amount ?? null,
        reason: data.reason ?? 'CUSTOMER_REQUEST',
        requestedBy,
      },
    });

    return refund;
  }

  async resendOrderEmail(requestedOrgId: string | undefined, orderId: string) {
    const order = await this.getOrder(requestedOrgId, orderId);
    await this.notifications.enqueueOrderConfirmation(
      order.id,
      order.buyerEmail,
      order.buyerName,
    );
    await this.notifications.enqueueTicketPDF(order.id, order.buyerEmail);

    await this.audit.log({
      action: 'ORDER_EMAIL_RESENT',
      entityType: 'Order',
      entityId: order.id,
      organizationId: order.organizationId,
      userId: this.tenant.current().userId,
      metadata: { publicId: order.publicId, email: order.buyerEmail },
    });

    return { ok: true as const, email: order.buyerEmail };
  }

  async cancelOrderForOrg(
    requestedOrgId: string | undefined,
    orderId: string,
    data: CancelOrderDto,
  ) {
    const order = await this.getOrder(requestedOrgId, orderId);
    if (order.status === 'COMPLETED' || order.status === 'REFUNDED') {
      throw new BadRequestException('Use refund for completed orders');
    }
    if (order.status === 'CANCELLED') {
      throw new BadRequestException('Order already cancelled');
    }

    const reason = data.reason?.trim() || 'Admin cancel';
    this.logger.log(`Cancel order ${order.id}: ${reason}`);

    const updated = await this.prisma.order.update({
      where: { id: order.id },
      data: { status: 'CANCELLED' },
      select: ORDER_LIST_SELECT,
    });

    await this.audit.log({
      action: 'ORDER_CANCELLED',
      entityType: 'Order',
      entityId: order.id,
      organizationId: order.organizationId,
      userId: this.tenant.current().userId,
      metadata: { publicId: order.publicId, reason },
    });

    return updated;
  }

  async listPayouts(requestedOrgId?: string, query: AdminPagedQueryDto = {}) {
    const organizationId = this.tenant.resolveOrganization(requestedOrgId);
    const limit = this.pageSize(query.limit);
    const [byChannel, payouts] = await Promise.all([
      this.prisma.order.groupBy({
        by: ['channel', 'currency'],
        where: { organizationId, status: 'COMPLETED' },
        _sum: { totalAmount: true, commissionAmount: true },
        _count: true,
      }),
      this.prisma.promoterPayout.findMany({
        where: { organizationId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        ...(query.cursor ? { skip: 1, cursor: { id: query.cursor } } : {}),
        select: PAYOUT_SELECT,
      }),
    ]);
    return { byChannel, payouts };
  }

  async markPayoutProcessing(
    requestedOrgId: string | undefined,
    payoutId: string,
    data: ProcessPayoutDto,
  ) {
    const organizationId = this.tenant.resolveOrganization(requestedOrgId);
    const payout = await this.requirePayout(payoutId, organizationId);
    if (payout.status === 'COMPLETED') {
      throw new BadRequestException('Payout already completed');
    }

    const updated = await this.prisma.promoterPayout.update({
      where: { id: payout.id },
      data: {
        status: 'PROCESSING',
        referenceId: data.referenceId ?? payout.referenceId,
        processedAt: new Date(),
      },
      select: PAYOUT_SELECT,
    });

    await this.audit.log({
      action: 'PAYOUT_PROCESSING',
      entityType: 'PromoterPayout',
      entityId: payout.id,
      organizationId,
      userId: this.tenant.current().userId,
      metadata: { referenceId: updated.referenceId },
    });

    return updated;
  }

  async markPayoutCompleted(
    requestedOrgId: string | undefined,
    payoutId: string,
    data: CompletePayoutDto,
  ) {
    const organizationId = this.tenant.resolveOrganization(requestedOrgId);
    const payout = await this.requirePayout(payoutId, organizationId);
    if (payout.status === 'COMPLETED') {
      throw new BadRequestException('Payout already completed');
    }

    const referenceId =
      data.referenceId ?? payout.referenceId ?? `manual-${Date.now()}`;

    const updated = await this.prisma.promoterPayout.update({
      where: { id: payout.id },
      data: {
        status: 'COMPLETED',
        referenceId,
        processedAt: new Date(),
      },
      select: PAYOUT_SELECT,
    });

    await this.audit.log({
      action: 'PAYOUT_COMPLETED',
      entityType: 'PromoterPayout',
      entityId: payout.id,
      organizationId,
      userId: this.tenant.current().userId,
      metadata: { referenceId },
    });

    return updated;
  }

  /**
   * Reporte de ventas del evento con dos vistas por rol:
   *
   *  - **Promotor** (PROMOTER): ve boletos vendidos y ventas a valor nominal
   *    (`gross` = subtotal, lo que le corresponde). NO ve el cargo por servicio.
   *  - **Interno** (ADMIN / SUPER_ADMIN): además ve `serviceFees` (ingreso de
   *    la plataforma) y `total` (lo que pagó el comprador).
   *
   * Desglose por canal (WEB / TAQUILLA), método de pago, terminal de taquilla
   * y día. Los agregados se calculan en memoria sobre las órdenes completadas
   * del rango: el volumen de un evento único lo permite y evita un groupBy por
   * cada eje.
   */
  async salesReport(
    requestedOrgId: string | undefined,
    query: AdminSalesReportQueryDto = {},
    viewer?: { role?: string },
  ) {
    const organizationId = this.tenant.resolveOrganization(
      query.organizationId ?? requestedOrgId,
    );
    const start = query.from
      ? new Date(query.from)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = query.to ? new Date(query.to) : new Date();
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Invalid from/to date');
    }
    if (start > end) throw new BadRequestException('"from" must be before "to"');

    const internal = viewer?.role === 'ADMIN' || viewer?.role === 'SUPER_ADMIN';

    const orders = await this.prisma.order.findMany({
      where: {
        organizationId,
        status: 'COMPLETED',
        createdAt: { gte: start, lte: end },
      },
      select: {
        id: true,
        channel: true,
        paymentMethod: true,
        subtotal: true,
        fees: true,
        totalAmount: true,
        createdAt: true,
        posOps: true,
        items: { select: { quantity: true } },
      },
    });

    type Bucket = {
      orders: number;
      tickets: number;
      gross: number;
      serviceFees: number;
      total: number;
    };
    const empty = (): Bucket => ({ orders: 0, tickets: 0, gross: 0, serviceFees: 0, total: 0 });
    const add = (b: Bucket, o: (typeof orders)[number]) => {
      b.orders += 1;
      b.tickets += o.items.reduce((n, i) => n + i.quantity, 0);
      b.gross += Number(o.subtotal);
      b.serviceFees += Number(o.fees);
      b.total += Number(o.totalAmount);
    };

    const totals = empty();
    const byChannel = new Map<string, Bucket>();
    const byPaymentMethod = new Map<string, Bucket>();
    const byTerminal = new Map<string, Bucket & { terminalId: string }>();
    const byDay = new Map<string, Bucket>();

    for (const o of orders) {
      add(totals, o);
      const ch = byChannel.get(o.channel) ?? empty();
      add(ch, o);
      byChannel.set(o.channel, ch);

      const pm = byPaymentMethod.get(o.paymentMethod) ?? empty();
      add(pm, o);
      byPaymentMethod.set(o.paymentMethod, pm);

      const day = o.createdAt.toISOString().slice(0, 10);
      const d = byDay.get(day) ?? empty();
      add(d, o);
      byDay.set(day, d);

      const terminalId = (o.posOps as { terminalId?: string } | null)?.terminalId;
      if (o.channel === 'TAQUILLA' && terminalId) {
        const t = byTerminal.get(terminalId) ?? { ...empty(), terminalId };
        add(t, o);
        byTerminal.set(terminalId, t);
      }
    }

    // Nombres de terminal para el desglose de taquillas.
    const terminalIds = [...byTerminal.keys()];
    const terminals = terminalIds.length
      ? await this.prisma.posTerminal.findMany({
          where: { id: { in: terminalIds }, organizationId },
          select: { id: true, name: true, locationName: true },
        })
      : [];
    const terminalName = new Map(terminals.map((t) => [t.id, t.name]));

    // El promotor no ve el cargo por servicio ni el total cobrado.
    const strip = <T extends Bucket>(b: T) => {
      if (internal) return b;
      const { serviceFees: _f, total: _t, ...rest } = b;
      return rest as Omit<T, 'serviceFees' | 'total'>;
    };
    const mapOut = <K extends string>(m: Map<K, Bucket>, key: string) =>
      [...m.entries()]
        .map(([k, b]) => ({ [key]: k, ...strip(b) }))
        .sort((a, b) => (b.gross as number) - (a.gross as number));

    return {
      range: { from: start.toISOString(), to: end.toISOString() },
      view: internal ? ('internal' as const) : ('promoter' as const),
      totals: strip(totals),
      byChannel: mapOut(byChannel, 'channel'),
      byPaymentMethod: mapOut(byPaymentMethod, 'paymentMethod'),
      byTerminal: [...byTerminal.values()]
        .map((b) => ({
          terminalId: b.terminalId,
          terminalName: terminalName.get(b.terminalId) ?? 'Terminal',
          ...strip(b),
        }))
        .sort((a, b) => b.gross - a.gross),
      byDay: [...byDay.entries()]
        .map(([date, b]) => ({ date, ...strip(b) }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    };
  }

  async suggestLayoutFromPlan(
    requestedOrgId: string | undefined,
    body: SuggestLayoutDto,
  ) {
    const organizationId = this.tenant.resolveOrganization(requestedOrgId);
    const venue = await this.prisma.venue.findUnique({
      where: { id: body.venueId },
      select: { id: true, name: true, organizationId: true },
    });
    if (!venue) throw new NotFoundException('Venue not found');
    this.tenant.assertResourceOrganization(venue.organizationId, organizationId);

    return {
      suggested: true as const,
      venueId: venue.id,
      sections: [
        {
          id: 'suggested-a',
          name: 'Sección A (sugerida)',
          slug: 'a',
          color: '#404040',
          seats: Array.from({ length: 10 }, (_, index) => ({
            id: `sug-${index}`,
            label: `A-${index + 1}`,
            x: 50 + (index % 5) * 40,
            y: 100 + Math.floor(index / 5) * 40,
            tier: 'standard',
          })),
        },
      ],
      note: `Sugerencia basada en: ${body.planDescription.slice(0, 200)}. Revisar en editor antes de publicar.`,
    };
  }

  private async requirePayout(
    payoutId: string,
    organizationId: string,
  ): Promise<{ id: string; referenceId: string | null; status: PayoutStatus }> {
    const payout = await this.prisma.promoterPayout.findUnique({
      where: { id: payoutId },
      select: { id: true, referenceId: true, status: true, organizationId: true },
    });
    if (!payout) throw new NotFoundException('Payout not found');
    this.tenant.assertResourceOrganization(payout.organizationId, organizationId);
    return payout;
  }

  private pageSize(limit?: number, fallback = 50): number {
    return Math.min(Math.max(limit ?? fallback, 1), 200);
  }
}
