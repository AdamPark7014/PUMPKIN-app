/**
 * Seed del evento único — Pumpkin Zone 2026.
 *
 * A diferencia de `seed.ts` (demo multi-tenant masivo), esto siembra
 * exactamente lo que la operación real necesita y nada más:
 *
 *   1 Organization  (Ricordi · Murad)         slug: pumpkin-zone
 *   1 Venue         (Downtown Angelópolis)    slug: downtown-angelopolis
 *   1 Event         (GA, LIVE)                slug: pumpkin-zone-2026
 *   3 Offers        General / Pasaje / Completa — precios de event-config
 *   N Tickets       AVAILABLE por oferta (inventario GA)
 *   2 Users         admin promotor + cajero de taquilla
 *   2 PosTerminal   taquilla principal + móvil
 *   PIN de gerente  (sha256 igual que ManagerPinService)
 *
 * Idempotente: todo va con upsert/skipDuplicates sobre claves estables.
 * Correrlo dos veces no duplica nada ni pisa ventas existentes
 * (los tickets ya vendidos no se tocan porque el createMany salta duplicados).
 *
 * Uso:
 *   pnpm --filter @boletera/database exec tsx scripts/seed-pumpkin.ts
 *
 * ⚠ TODO(confirmar) — mismos pendientes que apps/web/lib/event-config.ts:
 *   fechas y precios 2026 son del patrón 2025. Cambiar antes de vender.
 */
import { createHash } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import {
  PrismaClient,
  Currency,
  EventCategory,
  EventStatus,
  OrgType,
  PosTerminalStatus,
  TicketStatus,
  UserRole,
  type Prisma,
} from '../generated/client';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Configuración del evento. Espejo de apps/web/lib/event-config.ts — si
// cambias algo aquí, cámbialo allá (el storefront pinta desde ese archivo).
// ---------------------------------------------------------------------------

const ORG_SLUG = 'pumpkin-zone';
const VENUE_SLUG = 'downtown-angelopolis';
const EVENT_SLUG = 'pumpkin-zone-2026';

// TODO(confirmar): fechas reales 2026.
const STARTS_AT = new Date('2026-10-29T11:00:00-06:00');
const ENDS_AT = new Date('2026-11-02T00:00:00-06:00');
const SALES_START = new Date('2026-08-18T09:00:00-06:00');

// TODO(confirmar): precios y aforo reales por acceso.
const ZONES = [
  {
    zone: 'General',
    name: 'Acceso General',
    price: 180,
    capacity: 4000,
    maxPerOrder: 10,
  },
  {
    zone: 'Pasaje',
    name: 'General + Pasaje',
    price: 320,
    capacity: 2500,
    maxPerOrder: 8,
  },
  {
    zone: 'Completa',
    name: 'Experiencia Completa',
    price: 540,
    capacity: 800,
    maxPerOrder: 6,
  },
] as const;

const ADMIN_EMAIL = 'admin@pumpkinzone.mx';
const CASHIER_EMAIL = 'taquilla@pumpkinzone.mx';
/** Contraseña inicial de ambos usuarios. Cámbiala el primer día. */
const SEED_PASSWORD = 'PumpkinZone.2026';
/** PIN de gerente para cortesías/void. Cámbialo el primer día. */
const MANAGER_PIN = '4826';

/** Igual que ManagerPinService.hashPin — mismo prefijo, mismo algoritmo. */
function hashManagerPin(pin: string): string {
  return createHash('sha256').update(`boletera-mgr:${pin}`).digest('hex');
}

function ticketCode(zone: string, n: number): string {
  return `PZ26-${zone}-${String(n).padStart(5, '0')}`.toUpperCase();
}

async function main(): Promise<void> {
  console.log('— Seed Pumpkin Zone 2026 —');

  // 1. Organización -----------------------------------------------------------
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);

  const org = await prisma.organization.upsert({
    where: { slug: ORG_SLUG },
    update: {},
    create: {
      slug: ORG_SLUG,
      name: 'Pumpkin Zone',
      description: 'Festival de otoño y Halloween · Ricordi × Murad Producciones',
      type: OrgType.PROMOTER,
      email: ADMIN_EMAIL,
      country: 'MX',
      timezone: 'America/Mexico_City',
      currency: Currency.MXN,
      city: 'Puebla',
      state: 'Puebla',
      verified: true,
      verifiedAt: new Date(),
      // Evento propio: sin comisión de plataforma y sin reventa.
      commissionRate: 0,
      allowResale: false,
      settings: { managerPinHash: hashManagerPin(MANAGER_PIN) },
    },
  });
  console.log(`Organization  ${org.id} (${org.slug})`);

  // El upsert con update:{} no repara un PIN borrado a mano — asegúralo.
  const settings = (org.settings ?? {}) as Record<string, unknown>;
  if (!settings.managerPinHash) {
    await prisma.organization.update({
      where: { id: org.id },
      data: { settings: { ...settings, managerPinHash: hashManagerPin(MANAGER_PIN) } },
    });
    console.log('  · managerPinHash restaurado');
  }

  // 2. Usuarios ---------------------------------------------------------------
  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: { organizationId: org.id },
    create: {
      email: ADMIN_EMAIL,
      firstName: 'Admin',
      lastName: 'Pumpkin Zone',
      role: UserRole.PROMOTER,
      organizationId: org.id,
      password: passwordHash,
      provider: 'email',
      emailVerified: true,
      emailVerifiedAt: new Date(),
    },
  });
  const cashier = await prisma.user.upsert({
    where: { email: CASHIER_EMAIL },
    update: { organizationId: org.id },
    create: {
      email: CASHIER_EMAIL,
      firstName: 'Taquilla',
      lastName: 'Pumpkin Zone',
      role: UserRole.VENUE_MANAGER,
      organizationId: org.id,
      password: passwordHash,
      provider: 'email',
      emailVerified: true,
      emailVerifiedAt: new Date(),
    },
  });
  console.log(`Users         admin=${admin.id} cashier=${cashier.id}`);

  // 3. Venue ------------------------------------------------------------------
  const totalCapacity = ZONES.reduce((sum, z) => sum + z.capacity, 0);
  const venue = await prisma.venue.upsert({
    where: { slug: VENUE_SLUG },
    update: {},
    create: {
      slug: VENUE_SLUG,
      organizationId: org.id,
      name: 'Downtown Lomas de Angelópolis',
      address: 'Downtown Lomas de Angelópolis',
      city: 'Puebla',
      state: 'Puebla',
      country: 'MX',
      timezone: 'America/Mexico_City',
      totalCapacity,
      generalSeats: totalCapacity,
    },
  });
  console.log(`Venue         ${venue.id} (${venue.slug})`);

  // 4. Evento -----------------------------------------------------------------
  const prices = ZONES.map((z) => z.price);
  const event = await prisma.event.upsert({
    where: { slug: EVENT_SLUG },
    // La ventana de venta sí se corrige al re-sembrar; el resto no se pisa.
    update: { salesStartAt: SALES_START },
    create: {
      slug: EVENT_SLUG,
      organizationId: org.id,
      venueId: venue.id,
      title: 'Pumpkin Zone · 5ª Edición',
      description:
        'El lugar donde el otoño y Halloween se encuentran. Campo de calabazas, ' +
        'Pasaje Siniestro, talleres de tallado, cine al aire libre y shows nocturnos.',
      category: EventCategory.FESTIVAL,
      startsAt: STARTS_AT,
      endsAt: ENDS_AT,
      doorsAt: STARTS_AT,
      timezone: 'America/Mexico_City',
      status: EventStatus.LIVE,
      publishedAt: new Date(),
      salesStartAt: SALES_START,
      salesEndAt: ENDS_AT,
      minPrice: Math.min(...prices),
      maxPrice: Math.max(...prices),
      currency: Currency.MXN,
      totalCapacity,
      // GA sin reventa ni transferencias: menos superficie de fraude en la puerta.
      allowResale: false,
      transferAllowed: false,
      refundable: false,
      holdExpiration: 600,
    },
  });
  console.log(`Event         ${event.id} (${event.slug})`);

  // 5. Ofertas + inventario ---------------------------------------------------
  for (const z of ZONES) {
    const offer = await prisma.offer.upsert({
      // @@unique([eventId, zone])
      where: { eventId_zone: { eventId: event.id, zone: z.zone } },
      update: { startDate: SALES_START },
      create: {
        eventId: event.id,
        name: z.name,
        zone: z.zone,
        basePrice: z.price,
        fees: 0, // "Sin cargos por servicio sorpresa" — la promesa del home.
        currency: Currency.MXN,
        totalQuantity: z.capacity,
        remainingQuantity: z.capacity,
        minPerOrder: 1,
        maxPerOrder: z.maxPerOrder,
        startDate: SALES_START,
        endDate: ENDS_AT,
        isAvailable: true,
      },
    });

    const rows: Prisma.TicketCreateManyInput[] = Array.from(
      { length: z.capacity },
      (_, i) => ({
        code: ticketCode(z.zone, i + 1),
        eventId: event.id,
        offerId: offer.id,
        status: TicketStatus.AVAILABLE,
        section: z.name,
        originalPrice: z.price,
      }),
    );

    // skipDuplicates + code único ⇒ re-ejecutar no toca boletos vendidos.
    let created = 0;
    const BATCH = 1000;
    for (let i = 0; i < rows.length; i += BATCH) {
      const res = await prisma.ticket.createMany({
        data: rows.slice(i, i + BATCH),
        skipDuplicates: true,
      });
      created += res.count;
    }
    console.log(
      `Offer         ${z.zone.padEnd(9)} $${z.price} · ${z.capacity} lugares (${created} boletos nuevos)`,
    );
  }

  // 6. Terminales de taquilla -------------------------------------------------
  for (const name of ['Taquilla 1', 'Taquilla móvil']) {
    const existing = await prisma.posTerminal.findFirst({
      where: { organizationId: org.id, name },
      select: { id: true },
    });
    if (!existing) {
      await prisma.posTerminal.create({
        data: {
          organizationId: org.id,
          name,
          locationName: 'Downtown Lomas de Angelópolis',
          status: PosTerminalStatus.READY,
        },
      });
    }
    console.log(`PosTerminal   ${name}${existing ? ' (ya existía)' : ''}`);
  }

  console.log('\nListo. Credenciales iniciales (cámbialas el primer día):');
  console.log(`  Admin    ${ADMIN_EMAIL} / ${SEED_PASSWORD}`);
  console.log(`  Taquilla ${CASHIER_EMAIL} / ${SEED_PASSWORD}`);
  console.log(`  PIN gerente ${MANAGER_PIN}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
