/**
 * Boletera professional demo seed — deterministic, idempotent, batched.
 * Seed: 20260730 | Market: MX / MXN / America/Mexico_City
 */
import * as path from 'node:path';
import * as bcrypt from 'bcrypt';
import {
  PrismaClient,
  Currency,
  OrgType,
  UserRole,
  EventStatus,
  EventCategory,
  TicketStatus,
  OrderStatus,
  PaymentStatus,
  PaymentMethod,
  PaymentGateway,
  SalesChannel,
  HoldStatus,
  RefundReason,
  RefundStatus,
  FraudType,
  FraudSeverity,
  FraudStatus,
  ResaleStatus,
  ResaleOfferStatus,
  PromotionType,
  PayoutStatus,
  WaitlistStatus,
  TransferStatus,
  CfdiStatus,
  KYCStatus,
  AMLStatus,
  PosTerminalStatus,
  PosSessionStatus,
  SeasonPassPurchaseStatus,
  SalePhaseKind,
  SalePhaseStatus,
  EventSeriesKind,
  EventSeriesStatus,
  type Prisma,
} from '../generated/client';
import { SeedRng } from './seed-lib/rng';
import {
  DEMO_ORG_SLUGS,
  FIRST_NAMES,
  LAST_NAMES,
  MX_CITIES,
  SEED_NOW,
  SEED_PASSWORD,
  SEED_VERSION,
  daysFromSeed,
  monthsAgo,
  mxPhone,
  salesWeightAt,
} from './seed-lib/constants';
import { persistLayout, templateMap } from './seed-lib/layouts';
import { generateMegaStadiumMap, MEGA_ZONE_PRICES } from './seed-lib/mega-stadium';

// Empty PRISMA_QUERY_ENGINE_LIBRARY (common shell leftover) breaks engine load.
if (process.env.PRISMA_QUERY_ENGINE_LIBRARY === '') {
  delete process.env.PRISMA_QUERY_ENGINE_LIBRARY;
}
if (!process.env.PRISMA_QUERY_ENGINE_LIBRARY) {
  process.env.PRISMA_QUERY_ENGINE_LIBRARY = path.join(
    process.cwd(),
    'generated',
    'client',
    'query_engine-windows.dll.node',
  );
}

const prisma = new PrismaClient();
const RNG_SEED = 20260730;
const BATCH = 800;
const CUSTOMER_COUNT = 180;
const ORDER_TARGET = 4200;

type Counts = Record<string, number>;

function bump(counts: Counts, table: string, n = 1) {
  counts[table] = (counts[table] ?? 0) + n;
}

async function wipeDemoData(counts: Counts) {
  const orgs = await prisma.organization.findMany({
    where: { slug: { in: [...DEMO_ORG_SLUGS] } },
    select: { id: true },
  });
  const orgIds = orgs.map((o) => o.id);
  if (!orgIds.length) return;

  const events = await prisma.event.findMany({
    where: { organizationId: { in: orgIds } },
    select: { id: true },
  });
  const eventIds = events.map((e) => e.id);
  const tickets = eventIds.length
    ? await prisma.ticket.findMany({
        where: { eventId: { in: eventIds } },
        select: { id: true },
      })
    : [];
  const ticketIds = tickets.map((t) => t.id);
  const orders = await prisma.order.findMany({
    where: { organizationId: { in: orgIds } },
    select: { id: true, paymentId: true },
  });
  const orderIds = orders.map((o) => o.id);
  const paymentIds = orders.map((o) => o.paymentId).filter((id): id is string => !!id);

  if (ticketIds.length) {
    await prisma.ticketScan.deleteMany({ where: { ticketId: { in: ticketIds } } });
    await prisma.ticketTransfer.deleteMany({ where: { ticketId: { in: ticketIds } } });
    await prisma.resaleOffer.deleteMany({
      where: { listing: { ticketId: { in: ticketIds } } },
    });
    await prisma.resaleListing.deleteMany({ where: { ticketId: { in: ticketIds } } });
  }
  if (orderIds.length) {
    await prisma.refund.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.cfdiInvoice.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.fraudFlag.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.paymentIntent.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  }
  if (paymentIds.length) {
    await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
  }
  if (eventIds.length) {
    await prisma.seatHold.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.waitlistEntry.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.salePhase.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.dynamicPrice.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.review.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.eventAnalytics.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.seasonPassEvent.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.ticket.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.offer.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.eventSeatMap.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.fraudFlag.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
  }

  const venues = await prisma.venue.findMany({
    where: { organizationId: { in: orgIds } },
    select: { id: true },
  });
  const venueIds = venues.map((v) => v.id);
  if (venueIds.length) {
    await prisma.accessZone.deleteMany({ where: { venueId: { in: venueIds } } });
    await prisma.venueBlackout.deleteMany({ where: { venueId: { in: venueIds } } });
    const layouts = await prisma.venueLayout.findMany({
      where: { venueId: { in: venueIds } },
      select: { id: true },
    });
    for (const l of layouts) {
      await prisma.seat.deleteMany({ where: { section: { layoutId: l.id } } });
      await prisma.seatRow.deleteMany({ where: { section: { layoutId: l.id } } });
      await prisma.section.deleteMany({ where: { layoutId: l.id } });
    }
    await prisma.venueLayout.deleteMany({ where: { venueId: { in: venueIds } } });
  }

  await prisma.seasonPassPurchase.deleteMany({
    where: { seasonPass: { organizationId: { in: orgIds } } },
  });
  await prisma.seasonPassEvent.deleteMany({
    where: { seasonPass: { organizationId: { in: orgIds } } },
  });
  await prisma.seasonPass.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.eventSeries.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.promoterPayout.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.promotion.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.cfdiInvoice.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.fiscalProfile.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.apiKey.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.posCashierSession.deleteMany({
    where: { terminal: { organizationId: { in: orgIds } } },
  });
  await prisma.posTerminal.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.cashierShift.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.auditEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.tenantTheme.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.venue.deleteMany({ where: { organizationId: { in: orgIds } } });

  const staff = await prisma.user.findMany({
    where: { organizationId: { in: orgIds } },
    select: { id: true },
  });
  const demoCustomers = await prisma.user.findMany({
    where: {
      OR: [
        { email: { endsWith: '@demo.boletera.mx' } },
        { email: { endsWith: '@demo.boletera.com' } },
        { email: { endsWith: '@ocesa-demo.mx' } },
        { email: { endsWith: '@cie-demo.mx' } },
        { email: { endsWith: '@teatro-demo.mx' } },
        { email: { endsWith: '@boletera.mx' } },
      ],
    },
    select: { id: true },
  });
  const userIds = [...new Set([...staff, ...demoCustomers].map((u) => u.id))];
  if (userIds.length) {
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.cart.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.wishlist.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.review.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.fraudFlag.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  bump(counts, '_wipedOrgs', orgIds.length);
}

async function createManyBatched<T extends object>(
  label: string,
  rows: T[],
  insert: (chunk: T[]) => Promise<{ count: number }>,
  counts: Counts,
  table: string,
) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const res = await insert(chunk);
    bump(counts, table, res.count);
  }
  if (rows.length) process.stdout.write(`  ${label}: ${rows.length}\n`);
}

async function main() {
  const rng = new SeedRng(RNG_SEED);
  const counts: Counts = {};
  const started = Date.now();
  console.log(`\nBoletera demo seed ${SEED_VERSION} (rng=${RNG_SEED})\n`);

  console.log('1) Wipe previous demo orgs…');
  await wipeDemoData(counts);

  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);

  console.log('2) Organizations, themes, fiscal…');
  const orgDefs = [
    {
      slug: 'boletera-plataforma',
      name: 'Boletera Plataforma',
      type: OrgType.BOLETERA,
      email: 'ops@boletera.mx',
      color: '#111111',
      secondary: '#F5C518',
      subdomain: 'platform',
      commission: 0.12,
    },
    {
      slug: 'ocesa-live',
      name: 'OCESA Live México',
      type: OrgType.PROMOTER,
      email: 'promotor@ocesa-demo.mx',
      color: '#0B3D91',
      secondary: '#E10600',
      subdomain: 'ocesa',
      commission: 0.15,
    },
    {
      slug: 'cie-espectaculos',
      name: 'CIE Espectáculos',
      type: OrgType.PROMOTER,
      email: 'admin@cie-demo.mx',
      color: '#1A1A2E',
      secondary: '#E94560',
      subdomain: 'cie',
      commission: 0.14,
    },
    {
      slug: 'teatro-nacional-mx',
      name: 'Teatro Nacional MX',
      type: OrgType.VENUE,
      email: 'taquilla@teatro-demo.mx',
      color: '#3D2C29',
      secondary: '#D4A373',
      subdomain: 'teatro',
      commission: 0.1,
    },
  ] as const;

  const orgs: Array<{ id: string; slug: string; name: string }> = [];
  for (const def of orgDefs) {
    const org = await prisma.organization.create({
      data: {
        id: rng.id('org', def.slug),
        name: def.name,
        slug: def.slug,
        email: def.email,
        country: 'MX',
        timezone: 'America/Mexico_City',
        currency: Currency.MXN,
        type: def.type,
        verified: true,
        verifiedAt: monthsAgo(14),
        kycStatus: KYCStatus.VERIFIED,
        amlStatus: AMLStatus.VERIFIED,
        commissionRate: def.commission,
        resaleCommission: 0.08,
        allowResale: true,
        city: 'Ciudad de México',
        state: 'CDMX',
        address: 'Av. Reforma 222',
        phone: '+52 55 4000 1000',
        taxId: `BOL${def.slug.slice(0, 6).toUpperCase()}910101AAA`,
        bankAccountName: def.name,
        bankCode: '012',
        bankAccountNumber: `01218000${rng.int(10000000, 99999999)}`,
        tenantTheme: {
          create: {
            primaryColor: def.color,
            secondaryColor: def.secondary,
            subdomain: def.subdomain,
          },
        },
        fiscalProfile: {
          create: {
            rfc: `BOL${def.slug.replace(/-/g, '').slice(0, 6).toUpperCase()}910101AAA`.slice(0, 13),
            legalName: def.name,
            regimenFiscal: '601',
            codigoPostal: '06600',
            serie: 'A',
            nextFolio: 100,
            pacMode: 'sandbox',
            pacProvider: 'boletera-sandbox',
            active: true,
          },
        },
      },
    });
    orgs.push(org);
    bump(counts, 'Organization');
    bump(counts, 'TenantTheme');
    bump(counts, 'FiscalProfile');
  }

  const platform = orgs[0]!;
  const ocesa = orgs[1]!;
  const cie = orgs[2]!;
  const teatroOrg = orgs[3]!;

  console.log('3) Users (roles + customers)…');
  const staffSpecs: Array<{
    email: string;
    firstName: string;
    lastName: string;
    role: UserRole;
    organizationId: string;
  }> = [
    { email: 'admin@demo.boletera.com', firstName: 'Admin', lastName: 'Boletera', role: UserRole.SUPER_ADMIN, organizationId: platform.id },
    { email: 'taquilla@demo.boletera.com', firstName: 'Cajero', lastName: 'Central', role: UserRole.TAQUILLA, organizationId: platform.id },
    { email: 'scanner@demo.boletera.com', firstName: 'Acceso', lastName: 'QR', role: UserRole.SCANNER, organizationId: platform.id },
    { email: 'promotor@ocesa-demo.mx', firstName: 'Laura', lastName: 'Méndez', role: UserRole.PROMOTER, organizationId: ocesa.id },
    { email: 'admin@ocesa-demo.mx', firstName: 'Ricardo', lastName: 'OCESA', role: UserRole.ADMIN, organizationId: ocesa.id },
    { email: 'taquilla@ocesa-demo.mx', firstName: 'Sofía', lastName: 'Taquilla', role: UserRole.TAQUILLA, organizationId: ocesa.id },
    { email: 'admin@cie-demo.mx', firstName: 'Elena', lastName: 'CIE', role: UserRole.ADMIN, organizationId: cie.id },
    { email: 'venue@teatro-demo.mx', firstName: 'Héctor', lastName: 'Sala', role: UserRole.VENUE_MANAGER, organizationId: teatroOrg.id },
    { email: 'taquilla@teatro-demo.mx', firstName: 'Ana', lastName: 'Palco', role: UserRole.TAQUILLA, organizationId: teatroOrg.id },
    { email: 'cliente@demo.boletera.com', firstName: 'Cliente', lastName: 'Demo', role: UserRole.CUSTOMER, organizationId: platform.id },
  ];

  const staffUsers: Array<{ id: string; email: string; role: UserRole; organizationId: string | null }> = [];
  for (const s of staffSpecs) {
    const u = await prisma.user.upsert({
      where: { email: s.email },
      update: {
        firstName: s.firstName,
        lastName: s.lastName,
        password: passwordHash,
        role: s.role,
        organizationId: s.role === UserRole.CUSTOMER ? null : s.organizationId,
        emailVerified: true,
        active: true,
      },
      create: {
        id: rng.id('user', s.email),
        email: s.email,
        firstName: s.firstName,
        lastName: s.lastName,
        password: passwordHash,
        role: s.role,
        organizationId: s.role === UserRole.CUSTOMER ? null : s.organizationId,
        emailVerified: true,
        emailVerifiedAt: monthsAgo(10),
        active: true,
        phone: mxPhone(rng),
      },
    });
    staffUsers.push(u);
    bump(counts, 'User');
  }

  const customers: Array<{ id: string; email: string; firstName: string; lastName: string }> = [];
  const customerRows: Prisma.UserCreateManyInput[] = [];
  for (let i = 0; i < CUSTOMER_COUNT; i++) {
    const firstName = FIRST_NAMES[i % FIRST_NAMES.length]!;
    const lastName = LAST_NAMES[(i * 3) % LAST_NAMES.length]!;
    const email = `cliente.${String(i + 1).padStart(3, '0')}@demo.boletera.mx`;
    const id = rng.id('cust', i);
    customerRows.push({
      id,
      email,
      firstName,
      lastName,
      password: passwordHash,
      role: UserRole.CUSTOMER,
      emailVerified: true,
      emailVerifiedAt: monthsAgo(rng.int(1, 12)),
      active: true,
      phone: mxPhone(rng),
      createdAt: monthsAgo(rng.int(1, 14)),
    });
    customers.push({ id, email, firstName, lastName });
  }
  await createManyBatched('customers', customerRows, (data) => prisma.user.createMany({ data, skipDuplicates: true }), counts, 'User');

  const allBuyers = [
    ...customers,
    {
      id: staffUsers.find((u) => u.email === 'cliente@demo.boletera.com')!.id,
      email: 'cliente@demo.boletera.com',
      firstName: 'Cliente',
      lastName: 'Demo',
    },
  ];
  const cashierOcesa = staffUsers.find((u) => u.email === 'taquilla@ocesa-demo.mx')!;
  const cashierPlatform = staffUsers.find((u) => u.email === 'taquilla@demo.boletera.com')!;
  const scanner = staffUsers.find((u) => u.email === 'scanner@demo.boletera.com')!;

  console.log('4) Venues + layouts…');
  type VenuePack = {
    venueId: string;
    layoutId: string;
    snapshot: Awaited<ReturnType<typeof persistLayout>>['snapshot'];
    seatCount: number;
    orgId: string;
    kind: string;
  };
  const venuePacks: VenuePack[] = [];

  async function makeVenue(opts: {
    orgId: string;
    slug: string;
    name: string;
    address: string;
    city: string;
    state: string;
    kind: 'arena' | 'theater' | 'stadium' | 'festival' | 'foro' | 'mega';
    capacity: number;
  }): Promise<VenuePack> {
    const venue = await prisma.venue.create({
      data: {
        id: rng.id('ven', opts.slug),
        organizationId: opts.orgId,
        name: opts.name,
        slug: opts.slug,
        address: opts.address,
        city: opts.city,
        state: opts.state,
        country: 'MX',
        timezone: 'America/Mexico_City',
        totalCapacity: opts.capacity,
        generalSeats: opts.capacity,
        phone: mxPhone(rng),
        email: `contacto@${opts.slug}.mx`,
      },
    });
    bump(counts, 'Venue');

    let map;
    if (opts.kind === 'mega') {
      map = generateMegaStadiumMap({ idPrefix: opts.slug.slice(0, 8), targetSeats: opts.capacity });
    } else if (opts.kind === 'foro') {
      map = templateMap('arena', opts.slug.slice(0, 8), opts.capacity);
    } else {
      map = templateMap(opts.kind, opts.slug.slice(0, 8), opts.capacity);
    }

    const layout = await persistLayout(prisma, venue.id, `Layout ${opts.name}`, map);
    bump(counts, 'VenueLayout');
    bump(counts, 'Section', map.sections.length);
    bump(counts, 'Seat', layout.seatCount);

    for (const [i, zone] of ['General', 'VIP', 'Accesibilidad'].entries()) {
      await prisma.accessZone.create({
        data: {
          id: rng.id('zone', `${opts.slug}-${i}`),
          venueId: venue.id,
          name: zone,
          slug: zone.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, '-'),
          capacity: Math.floor(opts.capacity / (i === 0 ? 1.2 : 8)),
        },
      });
      bump(counts, 'AccessZone');
    }

    if (rng.bool(0.5)) {
      await prisma.venueBlackout.create({
        data: {
          venueId: venue.id,
          reason: 'Mantenimiento de pista / montaje',
          startsAt: daysFromSeed(40, 8),
          endsAt: daysFromSeed(41, 22),
          blocking: true,
          createdBy: staffUsers[0]!.id,
        },
      });
      bump(counts, 'VenueBlackout');
    }

    return {
      venueId: venue.id,
      layoutId: layout.layoutId,
      snapshot: layout.snapshot,
      seatCount: layout.seatCount,
      orgId: opts.orgId,
      kind: opts.kind,
    };
  }

  venuePacks.push(
    await makeVenue({
      orgId: ocesa.id,
      slug: 'palacio-de-los-deportes',
      name: 'Palacio de los Deportes',
      address: 'Av. Río Churubusco s/n',
      city: 'Ciudad de México',
      state: 'CDMX',
      kind: 'arena',
      capacity: 900,
    }),
    await makeVenue({
      orgId: ocesa.id,
      slug: 'arena-cdmx-demo',
      name: 'Arena CDMX',
      address: 'Av. de las Granjas 800',
      city: 'Ciudad de México',
      state: 'CDMX',
      kind: 'arena',
      capacity: 1200,
    }),
    await makeVenue({
      orgId: cie.id,
      slug: 'estadio-bbva-demo',
      name: 'Estadio BBVA',
      address: 'Av. Pablo Livas 2011',
      city: 'Guadalupe',
      state: 'Nuevo León',
      kind: 'stadium',
      capacity: 1600,
    }),
    await makeVenue({
      orgId: teatroOrg.id,
      slug: 'teatro-degollado-demo',
      name: 'Teatro Degollado',
      address: 'Degollado s/n, Centro',
      city: 'Guadalajara',
      state: 'Jalisco',
      kind: 'theater',
      capacity: 420,
    }),
    await makeVenue({
      orgId: cie.id,
      slug: 'foro-sol-demo',
      name: 'Foro Sol',
      address: 'Av. Viaducto Río de la Piedad s/n',
      city: 'Ciudad de México',
      state: 'CDMX',
      kind: 'foro',
      capacity: 2000,
    }),
    await makeVenue({
      orgId: ocesa.id,
      slug: 'parque-bicentenario-fest',
      name: 'Parque Bicentenario (Festival)',
      address: 'Av. de los Compositores / Azcapotzalco',
      city: 'Ciudad de México',
      state: 'CDMX',
      kind: 'festival',
      capacity: 1500,
    }),
    await makeVenue({
      orgId: ocesa.id,
      slug: 'estadio-azteca-demo',
      name: 'Estadio Azteca (Demo Scale)',
      address: 'Calz. de Tlalpan 3465',
      city: 'Ciudad de México',
      state: 'CDMX',
      kind: 'mega',
      capacity: 25_000,
    }),
  );

  const mega = venuePacks.find((v) => v.kind === 'mega') ?? venuePacks[venuePacks.length - 1]!;
  const arena = venuePacks.find((v) => v.kind === 'arena') ?? venuePacks[0]!;
  const theater = venuePacks.find((v) => v.kind === 'theater') ?? venuePacks[0]!;
  const stadium = venuePacks.find((v) => v.kind === 'stadium') ?? venuePacks[0]!;
  const festival = venuePacks.find((v) => v.kind === 'festival') ?? venuePacks[0]!;
  const foro = venuePacks.find((v) => v.kind === 'foro') ?? venuePacks.find((v) => v.kind === 'arena') ?? venuePacks[0]!;

  console.log(
    '  venues:',
    venuePacks.map((v) => `${v.kind}:${v.seatCount}`).join(', '),
  );

  console.log('5) Events, offers, tickets, sale phases…');

  type EventSpec = {
    slug: string;
    title: string;
    description: string;
    category: EventCategory;
    genre: string;
    orgId: string;
    pack: VenuePack;
    startsAt: Date;
    status: EventStatus;
    sellThrough: number;
    minPrice: number;
    image: string;
    announceOffsetDays: number;
  };

  const IMG = {
    rock: '/posters/concierto-demo-2026.svg',
    indie: '/posters/noche-indie-cdmx.svg',
    comedy: '/posters/stand-up-gdl.svg',
    theater: '/posters/obra-clasica-gdl.svg',
    sports: '/posters/clasico-regio.svg',
    fest: '/posters/festival-verano-mty.svg',
    electro: '/posters/electro-night-cdmx.svg',
    ballet: '/posters/ballet-gdl.svg',
    final: '/posters/final-regional-mty.svg',
    openair: '/posters/open-air-fest-cdmx.svg',
    jazz: '/posters/jazz-al-atardecer.svg',
    family: '/posters/comedia-abierta-cdmx.svg',
  };

  const eventSpecs: EventSpec[] = [
    // Past completed
    { slug: 'tour-anahuac-2025', title: 'Tour Anáhuac — CDMX', description: 'Cierre de gira con orquesta en vivo. Evento ya celebrado.', category: EventCategory.MUSIC, genre: 'Pop latino', orgId: ocesa.id, pack: arena, startsAt: daysFromSeed(-120, 21), status: EventStatus.COMPLETED, sellThrough: 0.96, minPrice: 650, image: IMG.rock, announceOffsetDays: 90 },
    { slug: 'clasico-regio-apertura', title: 'Clásico Regio — Apertura', description: 'Jornada 3 del torneo. Asistencia registrada.', category: EventCategory.SPORTS, genre: 'Fútbol', orgId: cie.id, pack: stadium, startsAt: daysFromSeed(-95, 19), status: EventStatus.COMPLETED, sellThrough: 0.88, minPrice: 320, image: IMG.sports, announceOffsetDays: 60 },
    { slug: 'carmen-degollado-2025', title: 'Carmen — Teatro Degollado', description: 'Temporada de ópera. Función completa.', category: EventCategory.THEATER, genre: 'Ópera', orgId: teatroOrg.id, pack: theater, startsAt: daysFromSeed(-70, 20), status: EventStatus.COMPLETED, sellThrough: 0.91, minPrice: 280, image: IMG.theater, announceOffsetDays: 75 },
    { slug: 'standup-nacional-invierno', title: 'Stand-up Nacional Invierno', description: 'Noche de comedia con headliners nacionales.', category: EventCategory.COMEDY, genre: 'Stand-up', orgId: cie.id, pack: foro, startsAt: daysFromSeed(-45, 21), status: EventStatus.COMPLETED, sellThrough: 0.84, minPrice: 350, image: IMG.comedy, announceOffsetDays: 40 },
    { slug: 'festival-primavera-cdmx', title: 'Festival Primavera CDMX', description: 'Dos escenarios, food court y zona familiar.', category: EventCategory.FESTIVAL, genre: 'Multi-género', orgId: ocesa.id, pack: festival, startsAt: daysFromSeed(-30, 14), status: EventStatus.COMPLETED, sellThrough: 0.79, minPrice: 990, image: IMG.fest, announceOffsetDays: 100 },
    { slug: 'seleccion-amistoso-azteca', title: 'Amistoso Selección — Azteca', description: 'Partido amistoso de alto perfil. Capacidad masiva.', category: EventCategory.SPORTS, genre: 'Fútbol', orgId: ocesa.id, pack: mega, startsAt: daysFromSeed(-15, 20), status: EventStatus.COMPLETED, sellThrough: 0.72, minPrice: 380, image: IMG.final, announceOffsetDays: 80 },
    // On sale now — various sell-through
    { slug: 'noche-indie-cdmx-live', title: 'Noche Indie CDMX', description: 'Tres bandas emergentes. Doors 19:00.', category: EventCategory.MUSIC, genre: 'Indie', orgId: ocesa.id, pack: arena, startsAt: daysFromSeed(4, 20), status: EventStatus.SCHEDULED, sellThrough: 0.82, minPrice: 450, image: IMG.indie, announceOffsetDays: 45 },
    { slug: 'electro-night-foro', title: 'Electro Night Foro Sol', description: 'Set continuo hasta tarde.', category: EventCategory.MUSIC, genre: 'Electrónica', orgId: cie.id, pack: foro, startsAt: daysFromSeed(8, 22), status: EventStatus.SCHEDULED, sellThrough: 0.61, minPrice: 620, image: IMG.electro, announceOffsetDays: 35 },
    { slug: 'ballet-gdl-verano', title: 'Ballet Contemporáneo GDL', description: 'Compañía residente, 95 min.', category: EventCategory.THEATER, genre: 'Ballet', orgId: teatroOrg.id, pack: theater, startsAt: daysFromSeed(6, 19), status: EventStatus.SCHEDULED, sellThrough: 0.55, minPrice: 380, image: IMG.ballet, announceOffsetDays: 50 },
    { slug: 'final-regional-mty-vivo', title: 'Final Regional MTY', description: 'Eliminatoria a partido único.', category: EventCategory.SPORTS, genre: 'Fútbol', orgId: cie.id, pack: stadium, startsAt: daysFromSeed(3, 18), status: EventStatus.SCHEDULED, sellThrough: 0.93, minPrice: 720, image: IMG.final, announceOffsetDays: 30 },
    { slug: 'comedia-abierta-cdmx', title: 'Comedia Abierta CDMX', description: 'Micrófono abierto + headliner.', category: EventCategory.COMEDY, genre: 'Comedia', orgId: platform.id, pack: arena, startsAt: daysFromSeed(11, 21), status: EventStatus.SCHEDULED, sellThrough: 0.38, minPrice: 250, image: IMG.family, announceOffsetDays: 25 },
    { slug: 'familia-parque-domingo', title: 'Domingo Familiar en el Parque', description: 'Show infantil, carpas y talleres.', category: EventCategory.FAMILY, genre: 'Familiar', orgId: cie.id, pack: festival, startsAt: daysFromSeed(9, 12), status: EventStatus.SCHEDULED, sellThrough: 0.47, minPrice: 180, image: IMG.openair, announceOffsetDays: 20 },
    { slug: 'concierto-demo-2026', title: 'Concierto Demo 2026', description: 'Show demo con mapa en vivo para QA Banorte/QR.', category: EventCategory.MUSIC, genre: 'Pop', orgId: platform.id, pack: arena, startsAt: daysFromSeed(28, 20), status: EventStatus.SCHEDULED, sellThrough: 0.22, minPrice: 800, image: IMG.rock, announceOffsetDays: 40 },
    // Presale / future
    { slug: 'open-air-fest-cdmx-26', title: 'Open Air Fest CDMX 2026', description: 'Festival al aire libre multi-género. Preventa activa.', category: EventCategory.FESTIVAL, genre: 'Festival', orgId: ocesa.id, pack: festival, startsAt: daysFromSeed(55, 14), status: EventStatus.SCHEDULED, sellThrough: 0.18, minPrice: 1250, image: IMG.openair, announceOffsetDays: 70 },
    { slug: 'jazz-atardecer-gdl', title: 'Jazz al Atardecer', description: 'Quinteto en vivo. Preventa miembros.', category: EventCategory.MUSIC, genre: 'Jazz', orgId: teatroOrg.id, pack: theater, startsAt: daysFromSeed(42, 18), status: EventStatus.SCHEDULED, sellThrough: 0.12, minPrice: 410, image: IMG.jazz, announceOffsetDays: 55 },
    { slug: 'clasico-nacional-azteca', title: 'Clásico Nacional — Azteca', description: 'Rivalidad histórica. Capacidad 25k para pruebas de escala.', category: EventCategory.SPORTS, genre: 'Fútbol', orgId: ocesa.id, pack: mega, startsAt: daysFromSeed(75, 18), status: EventStatus.SCHEDULED, sellThrough: 0.28, minPrice: 450, image: IMG.sports, announceOffsetDays: 90 },
    { slug: 'obra-nueva-degollado', title: 'Estreno — Casa de Muñecas', description: 'Montaje contemporáneo. Borrador publicado.', category: EventCategory.THEATER, genre: 'Drama', orgId: teatroOrg.id, pack: theater, startsAt: daysFromSeed(90, 20), status: EventStatus.SCHEDULED, sellThrough: 0.05, minPrice: 320, image: IMG.theater, announceOffsetDays: 60 },
    { slug: 'draft-residencia-arena', title: 'Residencia Arena (borrador)', description: 'Serie en preparación — no a la venta pública.', category: EventCategory.MUSIC, genre: 'Rock', orgId: ocesa.id, pack: arena, startsAt: daysFromSeed(120, 21), status: EventStatus.DRAFT, sellThrough: 0, minPrice: 700, image: IMG.rock, announceOffsetDays: 30 },
  ];

  type BuiltEvent = {
    id: string;
    slug: string;
    orgId: string;
    pack: VenuePack;
    startsAt: Date;
    status: EventStatus;
    sellThrough: number;
    announceAt: Date;
    salesStartAt: Date;
    minPrice: number;
    offerIds: Map<string, { id: string; price: number; zone: string; name: string }>;
    ticketIdsByOffer: Map<string, string[]>;
  };

  const builtEvents: BuiltEvent[] = [];

  for (const spec of eventSpecs) {
    const announceAt = new Date(spec.startsAt);
    announceAt.setDate(announceAt.getDate() - spec.announceOffsetDays);
    const salesStartAt = new Date(announceAt);
    salesStartAt.setDate(salesStartAt.getDate() + 3);
    const doorsAt = new Date(spec.startsAt);
    doorsAt.setHours(doorsAt.getHours() - 1);

    const campaigns = [
      {
        id: rng.id('camp', `${spec.slug}-eb`),
        eventId: '',
        name: 'Early Bird',
        type: 'early_bird',
        status: 'ENDED' as const,
        startsAt: announceAt.toISOString(),
        endsAt: new Date(salesStartAt.getTime() + 7 * 864e5).toISOString(),
        allocation: 200,
        quantityPerUser: 4,
        discountType: 'percentage' as const,
        discountValue: 15,
        redeemed: rng.int(40, 180),
      },
      {
        id: rng.id('camp', `${spec.slug}-ps`),
        eventId: '',
        name: 'Preventa Fan Club',
        type: 'presale',
        status: spec.status === EventStatus.DRAFT ? ('DRAFT' as const) : ('ACTIVE' as const),
        startsAt: salesStartAt.toISOString(),
        endsAt: spec.startsAt.toISOString(),
        allocation: 500,
        quantityPerUser: 6,
        discountType: 'percentage' as const,
        discountValue: 10,
        redeemed: rng.int(20, 300),
        codes: Array.from({ length: 12 }, (_, i) => `PS${spec.slug.slice(0, 3).toUpperCase()}${String(i).padStart(3, '0')}`),
      },
    ];

    const maxPrice =
      spec.pack.kind === 'mega'
        ? Math.max(...Object.values(MEGA_ZONE_PRICES))
        : Math.round(spec.minPrice * 1.8);

    const event = await prisma.event.create({
      data: {
        id: rng.id('evt', spec.slug),
        slug: spec.slug,
        organizationId: spec.orgId,
        venueId: spec.pack.venueId,
        title: spec.title,
        description: spec.description,
        category: spec.category,
        genre: spec.genre,
        image: spec.image,
        bannerImage: spec.image,
        startsAt: spec.startsAt,
        endsAt: new Date(spec.startsAt.getTime() + 3 * 3600e3),
        doorsAt,
        durationMinutes: 180,
        timezone: 'America/Mexico_City',
        status: spec.status,
        publishedAt: spec.status === EventStatus.DRAFT ? null : announceAt,
        announceAt,
        publishAt: announceAt,
        salesStartAt,
        salesEndAt: spec.startsAt,
        minPrice: spec.minPrice,
        maxPrice,
        currency: Currency.MXN,
        totalCapacity: spec.pack.seatCount,
        allowResale: true,
        transferAllowed: true,
        refundable: true,
        enableDynamic: spec.sellThrough > 0.5,
        metadata: {
          seedVersion: SEED_VERSION,
          posterAspect: spec.category === EventCategory.FESTIVAL ? '16/9' : '3/4',
          campaigns: campaigns.map((c) => ({ ...c, eventId: rng.id('evt', spec.slug) })),
          channels: {
            WEB: { enabled: true, allocation: 70 },
            TAQUILLA: { enabled: true, allocation: 20 },
            API: { enabled: true, allocation: 10 },
          },
          funnel: {
            impressions: rng.int(50_000, 400_000),
            clicks: rng.int(8_000, 60_000),
            addToCart: rng.int(2_000, 20_000),
            purchases: rng.int(500, 8_000),
          },
        },
      },
    });
    bump(counts, 'Event');

    await prisma.eventSeatMap.create({
      data: {
        eventId: event.id,
        layoutId: spec.pack.layoutId,
        snapshotData: spec.pack.snapshot as object,
        publishedAt: announceAt,
      },
    });
    bump(counts, 'EventSeatMap');

    const offerIds = new Map<string, { id: string; price: number; zone: string; name: string }>();
    const ticketIdsByOffer = new Map<string, string[]>();

    for (const section of spec.pack.snapshot.sections) {
      const tier = section.seats[0]?.tier ?? 'standard';
      let price: number;
      if (spec.pack.kind === 'mega' && MEGA_ZONE_PRICES[section.slug]) {
        price = MEGA_ZONE_PRICES[section.slug]!;
      } else {
        const mul = tier === 'premium' ? 1.45 : tier === 'economy' ? 0.72 : 1;
        price = Math.round(spec.minPrice * mul);
      }
      const qty = section.seats.length;
      const offerId = rng.id('off', `${spec.slug}-${section.slug}`);
      await prisma.offer.create({
        data: {
          id: offerId,
          eventId: event.id,
          name: section.name,
          zone: section.slug,
          basePrice: price,
          fees: Math.round(price * 0.12),
          currency: Currency.MXN,
          totalQuantity: qty,
          remainingQuantity: qty,
          soldQuantity: 0,
          startDate: salesStartAt,
          endDate: spec.startsAt,
          isAvailable: spec.status !== EventStatus.DRAFT,
        },
      });
      bump(counts, 'Offer');
      offerIds.set(section.slug, { id: offerId, price, zone: section.slug, name: section.name });

      const ticketRows: Prisma.TicketCreateManyInput[] = section.seats.map((seat, idx) => ({
        id: rng.id('tkt', `${spec.slug}-${section.slug}-${idx}`),
        code: `TKT-${spec.slug}-${section.slug}-${String(idx + 1).padStart(5, '0')}`.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 64),
        eventId: event.id,
        offerId,
        status: TicketStatus.AVAILABLE,
        seatId: seat.id,
        seatNumber: seat.label.includes('-') ? seat.label.split('-').pop()! : seat.label,
        row: seat.row || 'A',
        section: section.name,
        createdAt: salesStartAt,
      }));

      await createManyBatched(
        `tickets ${spec.slug}/${section.slug}`,
        ticketRows,
        (data) => prisma.ticket.createMany({ data, skipDuplicates: true }),
        counts,
        'Ticket',
      );
      ticketIdsByOffer.set(offerId, ticketRows.map((t) => t.id!));
    }

    // Sale phases
    const phases: Array<{ name: string; kind: SalePhaseKind; start: Date; end: Date; status: SalePhaseStatus; code?: string; discount?: number }> = [
      { name: 'Preventa código', kind: SalePhaseKind.PRESALE, start: salesStartAt, end: new Date(salesStartAt.getTime() + 5 * 864e5), status: SalePhaseStatus.ENDED, code: `PREV-${spec.slug.slice(0, 4).toUpperCase()}`, discount: 10 },
      { name: 'Venta general', kind: SalePhaseKind.PUBLIC, start: new Date(salesStartAt.getTime() + 5 * 864e5), end: spec.startsAt, status: spec.startsAt > SEED_NOW ? SalePhaseStatus.ACTIVE : SalePhaseStatus.ENDED },
    ];
    if (spec.startsAt > SEED_NOW) {
      phases.push({
        name: 'Puerta',
        kind: SalePhaseKind.DOOR,
        start: doorsAt,
        end: spec.startsAt,
        status: SalePhaseStatus.SCHEDULED,
        discount: 0,
      });
    }
    for (const ph of phases) {
      await prisma.salePhase.create({
        data: {
          eventId: event.id,
          name: ph.name,
          kind: ph.kind,
          code: ph.code,
          startsAt: ph.start,
          endsAt: ph.end,
          status: ph.status,
          channels: [SalesChannel.WEB, SalesChannel.TAQUILLA, SalesChannel.API],
          discountPercent: ph.discount,
          priority: ph.kind === SalePhaseKind.PRESALE ? 10 : 100,
        },
      });
      bump(counts, 'SalePhase');
    }

    builtEvents.push({
      id: event.id,
      slug: spec.slug,
      orgId: spec.orgId,
      pack: spec.pack,
      startsAt: spec.startsAt,
      status: spec.status,
      sellThrough: spec.sellThrough,
      announceAt,
      salesStartAt,
      minPrice: spec.minPrice,
      offerIds,
      ticketIdsByOffer,
    });
  }

  // Series
  const series = await prisma.eventSeries.create({
    data: {
      id: rng.id('ser', 'temporada-teatro'),
      organizationId: teatroOrg.id,
      venueId: theater.venueId,
      name: 'Temporada Teatro 2026',
      slug: 'temporada-teatro-2026',
      description: 'Abono de temporada en Degollado',
      kind: EventSeriesKind.SEASON,
      status: EventSeriesStatus.ACTIVE,
      category: EventCategory.THEATER,
      timezone: 'America/Mexico_City',
      recurrence: { frequency: 'MONTHLY', interval: 1, byMonthDay: [15] },
    },
  });
  bump(counts, 'EventSeries');
  const theaterEvents = builtEvents.filter((e) => e.pack.kind === 'theater');
  for (const [i, ev] of theaterEvents.entries()) {
    await prisma.event.update({
      where: { id: ev.id },
      data: { seriesId: series.id, seriesOrder: i + 1 },
    });
  }

  console.log('6) Sales history (orders, payments, tickets)…');
  const channels = [SalesChannel.WEB, SalesChannel.TAQUILLA, SalesChannel.API, SalesChannel.ADMIN] as const;
  const channelWeights = [0.62, 0.22, 0.12, 0.04];
  const payMethods = [
    PaymentMethod.CARD,
    PaymentMethod.OXXO,
    PaymentMethod.SPEI,
    PaymentMethod.CASH,
    PaymentMethod.CLIP,
  ] as const;
  const payWeights = [0.55, 0.15, 0.12, 0.1, 0.08];

  const orderRows: Prisma.OrderCreateManyInput[] = [];
  const paymentRows: Prisma.PaymentCreateManyInput[] = [];
  const itemRows: Prisma.OrderItemCreateManyInput[] = [];
  const intentRows: Prisma.PaymentIntentCreateManyInput[] = [];
  const ticketUpdates: Array<{
    id: string;
    eventId: string;
    orderItemId: string;
    status: TicketStatus;
    buyerName: string;
    buyerEmail: string;
    completedAt: Date;
  }> = [];
  const refundRows: Prisma.RefundCreateManyInput[] = [];
  const fraudRows: Prisma.FraudFlagCreateManyInput[] = [];
  const scanRows: Prisma.TicketScanCreateManyInput[] = [];
  const transferRows: Prisma.TicketTransferCreateManyInput[] = [];
  const resaleRows: Prisma.ResaleListingCreateManyInput[] = [];
  const resaleOfferRows: Prisma.ResaleOfferCreateManyInput[] = [];
  const waitlistRows: Prisma.WaitlistEntryCreateManyInput[] = [];
  const reviewRows: Prisma.ReviewCreateManyInput[] = [];
  const analyticsRows: Prisma.EventAnalyticsCreateManyInput[] = [];

  // Preload seat offers inventory cursors
  const offerCursor = new Map<string, number>();
  for (const ev of builtEvents) {
    for (const [offerId, ids] of ev.ticketIdsByOffer) {
      offerCursor.set(offerId, 0);
      void ids;
    }
  }

  let ordersMade = 0;
  const sellable = builtEvents.filter((e) => e.sellThrough > 0);

  // Approximate tickets to sell per event
  const sellPlan = sellable.map((ev) => {
    const totalTickets = [...ev.ticketIdsByOffer.values()].reduce((n, a) => n + a.length, 0);
    const target = Math.floor(totalTickets * ev.sellThrough);
    // Cap mega sales for seed speed while keeping meaningful volume
    const capped = ev.pack.kind === 'mega' ? Math.min(target, 8_000) : target;
    return { ev, target: capped, totalTickets };
  });

  for (const plan of sellPlan) {
    const { ev } = plan;
    const saleDays = Math.max(
      1,
      Math.floor((ev.startsAt.getTime() - ev.salesStartAt.getTime()) / 864e5),
    );
    const offers = [...ev.offerIds.values()];
    let sold = 0;
    let day = 0;

    while (sold < plan.target && day < saleDays + 2 && ordersMade < ORDER_TARGET * 2) {
      const dayDate = new Date(ev.salesStartAt);
      dayDate.setDate(dayDate.getDate() + day);
      if (dayDate > SEED_NOW && ev.status !== EventStatus.COMPLETED) {
        // only sell up to "now" for on-sale events
        if (dayDate > SEED_NOW) break;
      }
      if (ev.status === EventStatus.COMPLETED || dayDate <= SEED_NOW) {
        const weekday = dayDate.getDay();
        const weight = salesWeightAt(day, saleDays, weekday);
        const dayOrders = Math.max(1, Math.round(weight * (plan.target / saleDays) * 0.35));

        for (let o = 0; o < dayOrders && sold < plan.target; o++) {
          const buyer = rng.pick(allBuyers);
          const channel = rng.pickWeighted([...channels], channelWeights);
          const method = rng.pickWeighted([...payMethods], payWeights);
          const qty = rng.int(1, channel === SalesChannel.TAQUILLA ? 4 : 6);
          const offer = rng.pick(offers);
          const pool = ev.ticketIdsByOffer.get(offer.id)!;
          let cursor = offerCursor.get(offer.id) ?? 0;
          if (cursor + qty > pool.length) continue;
          const chosen = pool.slice(cursor, cursor + qty);
          offerCursor.set(offer.id, cursor + qty);

          const hour = channel === SalesChannel.TAQUILLA ? rng.int(10, 20) : rng.int(8, 23);
          const createdAt = new Date(dayDate);
          createdAt.setHours(hour, rng.int(0, 59), rng.int(0, 59), 0);

          const statusRoll = rng.next();
          let status: OrderStatus = OrderStatus.COMPLETED;
          if (statusRoll < 0.04) status = OrderStatus.FAILED;
          else if (statusRoll < 0.07) status = OrderStatus.CANCELLED;
          else if (statusRoll < 0.1) status = OrderStatus.PENDING;
          else if (statusRoll < 0.13) status = OrderStatus.REFUNDED;
          else if (statusRoll < 0.145) status = OrderStatus.PARTIALLY_REFUNDED;

          const unit = offer.price;
          const fees = Math.round(unit * 0.12) * qty;
          const subtotal = unit * qty;
          const tax = Math.round(subtotal * 0.16);
          const total = subtotal + fees + tax;
          const orderId = rng.id('ord', `${ordersMade}`);
          const publicId = `ORD-${String(ordersMade + 1).padStart(7, '0')}`;
          const paymentId = status === OrderStatus.PENDING || status === OrderStatus.FAILED ? null : rng.id('pay', ordersMade);
          const itemId = rng.id('oi', ordersMade);
          const cashierId =
            channel === SalesChannel.TAQUILLA
              ? (ev.orgId === ocesa.id ? cashierOcesa.id : cashierPlatform.id)
              : null;

          if (paymentId) {
            paymentRows.push({
              id: paymentId,
              gateway: method === PaymentMethod.CASH ? PaymentGateway.CASH : method === PaymentMethod.OXXO ? PaymentGateway.OXXO : method === PaymentMethod.SPEI ? PaymentGateway.SPEI : method === PaymentMethod.CLIP ? PaymentGateway.CLIP : PaymentGateway.BANORTE,
              externalId: `banorte_${ordersMade}_${rng.int(1000, 9999)}`,
              status:
                status === OrderStatus.REFUNDED || status === OrderStatus.PARTIALLY_REFUNDED
                  ? PaymentStatus.REFUNDED
                  : status === OrderStatus.FAILED
                    ? PaymentStatus.FAILED
                    : status === OrderStatus.COMPLETED
                      ? PaymentStatus.COMPLETED
                      : PaymentStatus.PENDING,
              amount: total,
              currency: Currency.MXN,
              method,
              lastFourDigits: method === PaymentMethod.CARD ? String(rng.int(1000, 9999)) : null,
              brand: method === PaymentMethod.CARD ? rng.pick(['visa', 'mastercard', 'amex']) : null,
              processedAt: createdAt,
              createdAt,
            });
          }

          orderRows.push({
            id: orderId,
            publicId,
            organizationId: ev.orgId,
            eventId: ev.id,
            userId: buyer.id,
            status,
            buyerEmail: buyer.email,
            buyerName: `${buyer.firstName} ${buyer.lastName}`,
            buyerPhone: mxPhone(rng),
            subtotal,
            fees,
            discountAmount: 0,
            taxAmount: tax,
            totalAmount: total,
            currency: Currency.MXN,
            commissionAmount: Math.round(total * 0.12),
            paymentId,
            paymentMethod: method,
            channel,
            cashierId,
            expiresAt: new Date(createdAt.getTime() + 30 * 60e3),
            completedAt: status === OrderStatus.COMPLETED || status === OrderStatus.REFUNDED || status === OrderStatus.PARTIALLY_REFUNDED ? createdAt : null,
            refundedAt: status === OrderStatus.REFUNDED || status === OrderStatus.PARTIALLY_REFUNDED ? new Date(createdAt.getTime() + 864e5) : null,
            createdAt,
            posOps:
              channel === SalesChannel.TAQUILLA
                ? { willCall: rng.bool(0.15), clientSaleId: `POS-${ordersMade}` }
                : undefined,
          });

          itemRows.push({
            id: itemId,
            orderId,
            offerId: offer.id,
            quantity: qty,
            unitPrice: unit,
            unitFees: Math.round(unit * 0.12),
            subtotal,
            createdAt,
          });

          intentRows.push({
            id: rng.id('pi', ordersMade),
            orderId,
            provider: PaymentGateway.BANORTE,
            externalId: `pi_${ordersMade}`,
            amount: total,
            currency: Currency.MXN,
            status:
              status === OrderStatus.COMPLETED
                ? PaymentStatus.COMPLETED
                : status === OrderStatus.FAILED
                  ? PaymentStatus.FAILED
                  : PaymentStatus.PENDING,
            channel,
            idempotencyKey: `idem_${ordersMade}`,
            createdAt,
          });

          if (status === OrderStatus.COMPLETED || status === OrderStatus.REFUNDED || status === OrderStatus.PARTIALLY_REFUNDED) {
            for (const tid of chosen) {
              ticketUpdates.push({
                id: tid,
                eventId: ev.id,
                orderItemId: itemId,
                status:
                  status === OrderStatus.REFUNDED
                    ? TicketStatus.REFUNDED
                    : ev.status === EventStatus.COMPLETED && rng.bool(0.88)
                      ? TicketStatus.USED
                      : TicketStatus.SOLD,
                buyerName: `${buyer.firstName} ${buyer.lastName}`,
                buyerEmail: buyer.email,
                completedAt: createdAt,
              });
            }
            sold += qty;
          }

          if (status === OrderStatus.REFUNDED || status === OrderStatus.PARTIALLY_REFUNDED) {
            refundRows.push({
              id: rng.id('ref', ordersMade),
              orderId,
              amount: status === OrderStatus.PARTIALLY_REFUNDED ? Math.round(total * 0.5) : total,
              reason: rng.pick([
                RefundReason.CUSTOMER_REQUEST,
                RefundReason.EVENT_CANCELLED,
                RefundReason.DUPLICATE,
                RefundReason.FRAUD,
              ]),
              status: RefundStatus.COMPLETED,
              requestedBy: buyer.email,
              processedBy: 'admin@demo.boletera.com',
              requestedAt: new Date(createdAt.getTime() + 3600e3),
              processedAt: new Date(createdAt.getTime() + 864e5),
            });
          }

          if (status === OrderStatus.FAILED || rng.bool(0.02)) {
            fraudRows.push({
              id: rng.id('frd', ordersMade),
              eventId: ev.id,
              orderId,
              userId: buyer.id,
              type: rng.pick([
                FraudType.HIGH_VELOCITY,
                FraudType.SUSPICIOUS_ACTIVITY,
                FraudType.CHARGEBACK,
                FraudType.SCALPING_VIOLATION,
                FraudType.MULTIPLE_DECLINED,
              ]),
              severity: rng.pick([FraudSeverity.LOW, FraudSeverity.MEDIUM, FraudSeverity.HIGH, FraudSeverity.CRITICAL]),
              score: rng.int(20, 98),
              reason: 'Señal automática del motor de riesgo (seed)',
              status: rng.pick([FraudStatus.FLAGGED, FraudStatus.INVESTIGATING, FraudStatus.RESOLVED, FraudStatus.FALSE_POSITIVE]),
              ipAddress: `187.190.${rng.int(1, 254)}.${rng.int(1, 254)}`,
              createdAt,
            });
          }

          ordersMade += 1;
        }
      }
      day += 1;
    }

    // Update offer sold counts
    for (const offer of offers) {
      const cursor = offerCursor.get(offer.id) ?? 0;
      await prisma.offer.update({
        where: { id: offer.id },
        data: {
          soldQuantity: cursor,
          remainingQuantity: Math.max(0, (ev.ticketIdsByOffer.get(offer.id)?.length ?? 0) - cursor),
        },
      });
    }

    analyticsRows.push({
      id: rng.id('an', ev.slug),
      eventId: ev.id,
      totalTicketsSold: Math.min(plan.target, sold),
      totalRevenue: Math.round(sold * (ev.minPrice * 1.2)),
      totalFees: Math.round(sold * ev.minPrice * 0.12),
      averagePrice: ev.minPrice,
      uniqueBuyers: Math.floor(sold * 0.7),
      repeatBuyers: Math.floor(sold * 0.15),
      date: SEED_NOW,
    });
  }

  await createManyBatched('payments', paymentRows, (data) => prisma.payment.createMany({ data, skipDuplicates: true }), counts, 'Payment');
  await createManyBatched('orders', orderRows, (data) => prisma.order.createMany({ data, skipDuplicates: true }), counts, 'Order');
  await createManyBatched('orderItems', itemRows, (data) => prisma.orderItem.createMany({ data, skipDuplicates: true }), counts, 'OrderItem');
  await createManyBatched('paymentIntents', intentRows, (data) => prisma.paymentIntent.createMany({ data, skipDuplicates: true }), counts, 'PaymentIntent');
  await createManyBatched('refunds', refundRows, (data) => prisma.refund.createMany({ data, skipDuplicates: true }), counts, 'Refund');
  await createManyBatched('fraudFlags', fraudRows, (data) => prisma.fraudFlag.createMany({ data, skipDuplicates: true }), counts, 'FraudFlag');
  await createManyBatched('eventAnalytics', analyticsRows, (data) => prisma.eventAnalytics.createMany({ data, skipDuplicates: true }), counts, 'EventAnalytics');

  console.log('7) Ticket status updates (raw batched)…');
  for (let i = 0; i < ticketUpdates.length; i += 200) {
    const chunk = ticketUpdates.slice(i, i + 200);
    const values = chunk
      .map((t, idx) => {
        const checked =
          t.status === TicketStatus.USED
            ? `'${new Date(t.completedAt.getTime() + (30 + (idx % 150)) * 60e3).toISOString()}'::timestamptz`
            : 'NULL::timestamptz';
        const used =
          t.status === TicketStatus.USED
            ? `'${new Date(t.completedAt.getTime() + (40 + (idx % 160)) * 60e3).toISOString()}'::timestamptz`
            : 'NULL::timestamptz';
        const name = t.buyerName.replace(/'/g, "''");
        const email = t.buyerEmail.replace(/'/g, "''");
        return `('${t.id}','${t.orderItemId}','${t.status}','${name}','${email}',${checked},${used})`;
      })
      .join(',');
    await prisma.$executeRawUnsafe(`
      UPDATE "Ticket" AS t SET
        "orderItemId" = v.order_item_id,
        "status" = v.status::"TicketStatus",
        "buyerName" = v.buyer_name,
        "buyerEmail" = v.buyer_email,
        "checkedInAt" = v.checked_in_at,
        "usedAt" = v.used_at
      FROM (VALUES ${values}) AS v(id, order_item_id, status, buyer_name, buyer_email, checked_in_at, used_at)
      WHERE t.id = v.id
    `);
  }
  bump(counts, 'TicketUpdated', ticketUpdates.length);

  console.log('8) Access scans, transfers, resale, waitlist…');
  const completedEvents = builtEvents.filter((e) => e.status === EventStatus.COMPLETED);
  for (const ev of completedEvents) {
    const used = ticketUpdates.filter((t) => t.status === TicketStatus.USED && t.eventId === ev.id);
    const sample = used.slice(0, Math.min(used.length, ev.pack.kind === 'mega' ? 2500 : used.length));
    const zones = await prisma.accessZone.findMany({ where: { venueId: ev.pack.venueId } });
    for (const t of sample) {
      // Check-in curve: peak around doors + 30–90 min
      const doors = new Date(ev.startsAt);
      doors.setHours(doors.getHours() - 1);
      const offsetMin = Math.floor(rng.pickWeighted(
        [10, 25, 40, 55, 70, 90, 120, 150],
        [0.05, 0.12, 0.22, 0.25, 0.18, 0.1, 0.05, 0.03],
      ));
      const scannedAt = new Date(doors.getTime() + offsetMin * 60e3);
      const success = rng.bool(0.97);
      scanRows.push({
        id: rng.id('scan', t.id),
        ticketId: t.id,
        zoneId: zones.length ? rng.pick(zones).id : null,
        scannedBy: scanner.id,
        channel: SalesChannel.TAQUILLA,
        success,
        reason: success ? null : 'QR ya utilizado / boleto inválido',
        scannedAt,
      });
    }

    // No-shows already implied by SOLD without USED
    for (let i = 0; i < Math.min(40, sample.length); i++) {
      const t = sample[i]!;
      if (!rng.bool(0.08)) continue;
      const to = rng.pick(allBuyers);
      transferRows.push({
        id: rng.id('trf', t.id),
        ticketId: t.id,
        fromUserId: allBuyers[0]!.id,
        toEmail: to.email,
        toUserId: to.id,
        transferCode: `TRF${rng.int(100000, 999999)}`,
        status: rng.pick([TransferStatus.ACCEPTED, TransferStatus.PENDING, TransferStatus.EXPIRED]),
        expiresAt: new Date(ev.startsAt.getTime() - 864e5),
        acceptedAt: SEED_NOW,
        createdAt: new Date(ev.salesStartAt.getTime() + rng.int(5, 40) * 864e5),
      });
    }
  }

  // Resale on on-sale events
  const onsale = builtEvents.filter((e) => e.status === EventStatus.SCHEDULED && e.sellThrough > 0.2);
  for (const ev of onsale) {
    const soldTickets = ticketUpdates.filter((t) => t.status === TicketStatus.SOLD && t.eventId === ev.id).slice(0, 30);
    for (const t of soldTickets.slice(0, rng.int(5, 18))) {
      const asking = Math.round(ev.minPrice * rng.pick([1.1, 1.25, 1.4, 1.6]));
      const listingId = rng.id('rsl', t.id);
      resaleRows.push({
        id: listingId,
        ticketId: t.id,
        sellerId: rng.pick(allBuyers).id,
        sellerName: 'Vendedor Fan',
        askingPrice: asking,
        currency: Currency.MXN,
        fee: Math.round(asking * 0.08),
        status: rng.pick([ResaleStatus.ACTIVE, ResaleStatus.SOLD, ResaleStatus.DELISTED]),
        listedAt: daysFromSeed(-rng.int(1, 20)),
      });
      if (rng.bool(0.4)) {
        resaleOfferRows.push({
          id: rng.id('rso', t.id),
          listingId,
          buyerId: rng.pick(allBuyers).id,
          buyerEmail: rng.pick(allBuyers).email,
          offerPrice: Math.round(asking * 0.9),
          status: rng.pick([ResaleOfferStatus.PENDING, ResaleOfferStatus.ACCEPTED, ResaleOfferStatus.REJECTED]),
          expiresAt: daysFromSeed(3),
        });
      }
      // mark ticket as RESOLD sometimes
      if (rng.bool(0.3)) {
        await prisma.ticket.updateMany({
          where: { id: t.id },
          data: { status: TicketStatus.RESOLD, isResale: true, resalePrice: asking, originalPrice: ev.minPrice },
        });
      }
    }

    for (let w = 0; w < rng.int(15, 60); w++) {
      const buyer = rng.pick(allBuyers);
      waitlistRows.push({
        id: rng.id('wl', `${ev.slug}-${w}`),
        eventId: ev.id,
        email: `waitlist.${ev.slug}.${w}@demo.boletera.mx`,
        phone: mxPhone(rng),
        firstName: buyer.firstName,
        lastName: buyer.lastName,
        quantity: rng.int(1, 4),
        status: rng.pick([WaitlistStatus.PENDING, WaitlistStatus.NOTIFIED, WaitlistStatus.CONVERTED, WaitlistStatus.EXPIRED]),
        priority: rng.int(0, 100),
        createdAt: daysFromSeed(-rng.int(1, 25)),
      });
    }
  }

  for (const ev of completedEvents) {
    for (let r = 0; r < rng.int(8, 25); r++) {
      const buyer = rng.pick(allBuyers);
      reviewRows.push({
        id: rng.id('rev', `${ev.slug}-${r}`),
        eventId: ev.id,
        userId: buyer.id,
        rating: rng.int(3, 5),
        comment: rng.pick([
          'Excelente organización y acceso rápido.',
          'Buena vista, la app de boletos funcionó perfecto.',
          'Filas largas en taquilla pero el show valió la pena.',
          'QR sin fallas en el torniquete.',
        ]),
        createdAt: new Date(ev.startsAt.getTime() + rng.int(1, 5) * 864e5),
      });
    }
  }

  await createManyBatched('scans', scanRows, (data) => prisma.ticketScan.createMany({ data, skipDuplicates: true }), counts, 'TicketScan');
  await createManyBatched('transfers', transferRows, (data) => prisma.ticketTransfer.createMany({ data, skipDuplicates: true }), counts, 'TicketTransfer');
  await createManyBatched('resale', resaleRows, (data) => prisma.resaleListing.createMany({ data, skipDuplicates: true }), counts, 'ResaleListing');
  await createManyBatched('resaleOffers', resaleOfferRows, (data) => prisma.resaleOffer.createMany({ data, skipDuplicates: true }), counts, 'ResaleOffer');
  await createManyBatched('waitlist', waitlistRows, (data) => prisma.waitlistEntry.createMany({ data, skipDuplicates: true }), counts, 'WaitlistEntry');
  await createManyBatched('reviews', reviewRows, (data) => prisma.review.createMany({ data, skipDuplicates: true }), counts, 'Review');

  console.log('9) Promotions, season passes, partners, payouts, CFDI, POS, audit…');
  const promoDefs = [
    { code: 'BIENVENIDO10', name: 'Bienvenido 10%', type: PromotionType.PERCENTAGE, value: 10 },
    { code: 'FESTIVAL150', name: 'Festival -$150', type: PromotionType.FIXED_AMOUNT, value: 150 },
    { code: 'FAMILIA20', name: 'Familia 20%', type: PromotionType.PERCENTAGE, value: 20 },
    { code: 'OCESAPREV', name: 'Preventa OCESA', type: PromotionType.PERCENTAGE, value: 15 },
    { code: 'TEATROABONO', name: 'Abono teatro', type: PromotionType.PERCENTAGE, value: 12 },
  ];
  for (const org of orgs) {
    for (const p of promoDefs) {
      await prisma.promotion.create({
        data: {
          id: rng.id('prm', `${org.slug}-${p.code}`),
          code: `${p.code}-${org.slug.slice(0, 4).toUpperCase()}`,
          organizationId: org.id,
          name: p.name,
          type: p.type,
          value: p.value,
          maxDiscount: 500,
          minOrderAmount: 200,
          usageLimit: 2000,
          usageCount: rng.int(50, 800),
          startDate: monthsAgo(10),
          endDate: daysFromSeed(120),
        },
      });
      bump(counts, 'Promotion');
    }
  }

  const seasonPass = await prisma.seasonPass.create({
    data: {
      id: rng.id('sp', 'teatro-2026'),
      organizationId: teatroOrg.id,
      venueId: theater.venueId,
      name: 'Abono Temporada Degollado 2026',
      slug: 'abono-degollado-2026',
      description: 'Acceso a la temporada de teatro y ballet',
      seasonLabel: '2026',
      startsAt: daysFromSeed(-60),
      endsAt: daysFromSeed(200),
      price: 4500,
      currency: Currency.MXN,
      maxQuantity: 400,
      soldQuantity: 120,
      active: true,
      benefits: { parking: true, lounge: false, discountBar: '10%' },
    },
  });
  bump(counts, 'SeasonPass');
  for (const ev of theaterEvents) {
    await prisma.seasonPassEvent.create({
      data: { seasonPassId: seasonPass.id, eventId: ev.id },
    });
    bump(counts, 'SeasonPassEvent');
  }
  const spPurchases: Prisma.SeasonPassPurchaseCreateManyInput[] = [];
  for (let i = 0; i < 80; i++) {
    const b = rng.pick(allBuyers);
    spPurchases.push({
      id: rng.id('spp', i),
      seasonPassId: seasonPass.id,
      userId: b.id,
      buyerEmail: b.email,
      buyerName: `${b.firstName} ${b.lastName}`,
      quantity: 1,
      totalAmount: 4500,
      status: rng.pick([
        SeasonPassPurchaseStatus.COMPLETED,
        SeasonPassPurchaseStatus.COMPLETED,
        SeasonPassPurchaseStatus.PENDING,
        SeasonPassPurchaseStatus.CANCELLED,
      ]),
      seatSection: rng.pick(['Platea', 'Palco', 'Galería']),
      createdAt: monthsAgo(rng.int(1, 8)),
    });
  }
  await createManyBatched('seasonPurchases', spPurchases, (data) => prisma.seasonPassPurchase.createMany({ data, skipDuplicates: true }), counts, 'SeasonPassPurchase');

  for (const org of orgs) {
    await prisma.apiKey.create({
      data: {
        id: rng.id('key', org.slug),
        organizationId: org.id,
        name: `Partner ${org.name}`,
        keyHash: rng.id('hash', org.slug).padEnd(64, '0'),
        keyPrefix: `bk_live_${org.slug.slice(0, 4)}`,
        scopes: ['read:events', 'read:inventory', 'write:orders'],
        rateLimit: 5000,
        active: true,
        lastUsedAt: daysFromSeed(-1),
        createdById: staffUsers[0]!.id,
      },
    });
    bump(counts, 'ApiKey');

    for (let m = 1; m <= 12; m++) {
      const start = monthsAgo(12 - m + 1, 1);
      const end = monthsAgo(12 - m, 28);
      const gross = rng.int(180_000, 2_400_000);
      const commission = Math.round(gross * 0.12);
      await prisma.promoterPayout.create({
        data: {
          id: rng.id('po', `${org.slug}-${m}`),
          organizationId: org.id,
          periodStart: start,
          periodEnd: end,
          grossRevenue: gross,
          commission,
          netAmount: gross - commission,
          status: m < 11 ? PayoutStatus.COMPLETED : PayoutStatus.PENDING,
          method: PaymentMethod.BANK_TRANSFER,
          referenceId: `SPEI-PO-${org.slug}-${m}`,
          processedAt: m < 11 ? end : null,
        },
      });
      bump(counts, 'PromoterPayout');
    }
  }

  // CFDI sample for completed orders
  const completedOrderSample = orderRows.filter((o) => o.status === OrderStatus.COMPLETED).slice(0, 120);
  const cfdiRows: Prisma.CfdiInvoiceCreateManyInput[] = completedOrderSample.map((o, i) => ({
    id: rng.id('cfdi', i),
    organizationId: o.organizationId!,
    orderId: o.id!,
    uuid: `${rng.id('uuid', i)}-0000-4000-8000-${String(i).padStart(12, '0')}`.slice(0, 36),
    serie: 'A',
    folio: 1000 + i,
    tipo: 'I',
    status: CfdiStatus.STAMPED,
    receptorRfc: 'XAXX010101000',
    receptorNombre: o.buyerName!,
    receptorUsoCfdi: 'G03',
    subtotal: o.subtotal!,
    iva: o.taxAmount!,
    total: o.totalAmount!,
    currency: Currency.MXN,
    stampedAt: o.completedAt ?? SEED_NOW,
    createdAt: o.createdAt ?? SEED_NOW,
  }));
  await createManyBatched('cfdi', cfdiRows, (data) => prisma.cfdiInvoice.createMany({ data, skipDuplicates: true }), counts, 'CfdiInvoice');

  // POS terminals + sessions
  for (const org of [platform, ocesa, teatroOrg]) {
    for (let t = 0; t < 3; t++) {
      const terminal = await prisma.posTerminal.create({
        data: {
          id: rng.id('pos', `${org.slug}-${t}`),
          organizationId: org.id,
          name: `Terminal ${t + 1}`,
          locationName: rng.pick(['Acceso A', 'Acceso B', 'Boutique', 'Will-Call']),
          status: t === 2 ? PosTerminalStatus.OFFLINE : PosTerminalStatus.READY,
          offlineMode: t === 2,
          lastSyncAt: daysFromSeed(0, 12),
        },
      });
      bump(counts, 'PosTerminal');
      const cashier = org.id === ocesa.id ? cashierOcesa : cashierPlatform;
      await prisma.posCashierSession.create({
        data: {
          id: rng.id('pss', `${org.slug}-${t}`),
          terminalId: terminal.id,
          cashierId: cashier.id,
          status: t === 0 ? PosSessionStatus.ACTIVE : PosSessionStatus.CLOSED,
          startedAt: daysFromSeed(0, 9),
          endedAt: t === 0 ? null : daysFromSeed(0, 18),
          metadata: { openingCash: 2000, city: MX_CITIES[0].city },
        },
      });
      bump(counts, 'PosCashierSession');
      await prisma.cashierShift.create({
        data: {
          id: rng.id('sh', `${org.slug}-${t}`),
          userId: cashier.id,
          organizationId: org.id,
          openedAt: daysFromSeed(0, 9),
          closedAt: t === 0 ? null : daysFromSeed(0, 18),
          openingCash: 2000,
          closingCash: t === 0 ? null : 2000 + rng.int(5000, 40000),
          totalSales: rng.int(8000, 90000),
        },
      });
      bump(counts, 'CashierShift');
    }
  }

  // Active holds for on-sale demo
  const demoEvent = builtEvents.find((e) => e.slug === 'concierto-demo-2026');
  if (demoEvent) {
    const offer = [...demoEvent.offerIds.values()][0]!;
    const pool = demoEvent.ticketIdsByOffer.get(offer.id)!.slice(-20);
    for (let i = 0; i < 8; i++) {
      await prisma.seatHold.create({
        data: {
          id: rng.id('hold', i),
          eventId: demoEvent.id,
          seatId: null,
          offerId: offer.id,
          sessionId: `web-session-${i}`,
          channel: SalesChannel.WEB,
          quantity: 1,
          expiresAt: new Date(SEED_NOW.getTime() + 15 * 60e3),
          status: HoldStatus.ACTIVE,
        },
      });
      bump(counts, 'SeatHold');
      await prisma.ticket.update({
        where: { id: pool[i]! },
        data: { status: TicketStatus.HELD },
      });
    }
  }

  const auditRows: Prisma.AuditEventCreateManyInput[] = [];
  for (let i = 0; i < 200; i++) {
    const org = rng.pick(orgs);
    auditRows.push({
      id: rng.id('aud', i),
      organizationId: org.id,
      userId: rng.pick(staffUsers).id,
      action: rng.pick(['ORDER_REFUND', 'EVENT_PUBLISH', 'PRICE_UPDATE', 'USER_LOGIN', 'PAYOUT_APPROVE', 'SCAN_OVERRIDE']),
      entityType: rng.pick(['Order', 'Event', 'Offer', 'User', 'PromoterPayout']),
      entityId: rng.id('ent', i),
      ipAddress: `189.${rng.int(1, 250)}.${rng.int(1, 250)}.${rng.int(1, 250)}`,
      metadata: { seed: SEED_VERSION },
      createdAt: daysFromSeed(-rng.int(0, 60), rng.int(8, 22)),
    });
  }
  await createManyBatched('audit', auditRows, (data) => prisma.auditEvent.createMany({ data, skipDuplicates: true }), counts, 'AuditEvent');

  // Wishlists + carts for a few customers
  for (let i = 0; i < 40; i++) {
    const c = customers[i]!;
    const ev = rng.pick(builtEvents.filter((e) => e.status === EventStatus.SCHEDULED));
    await prisma.wishlist.create({
      data: { userId: c.id, eventId: ev.id },
    }).catch(() => undefined);
    bump(counts, 'Wishlist');
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log('\n=== Seed complete ===');
  console.log(`Elapsed: ${elapsed}s`);
  console.log('Rows created (approx):');
  const sorted = Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [k, v] of sorted) {
    console.log(`  ${k}: ${v}`);
  }
  console.log('\nLogins:');
  console.log('  admin@demo.boletera.com / Admin123!');
  console.log('  taquilla@demo.boletera.com / Admin123!');
  console.log('  promotor@ocesa-demo.mx / Admin123!');
  console.log(`Mega venue seats: ${mega.seatCount}`);
  console.log(`Events: ${builtEvents.length} | Orders buffered: ${orderRows.length}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
