import { PrismaClient, EventStatus, TicketStatus, UserRole, OrgType, Currency } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { generateLayoutTemplate, type LayoutTemplateId } from '@boletera/venue-engine';
import type { SeatMapData } from '@boletera/shared';

const prisma = new PrismaClient();

async function persistLayoutFromTemplate(
  venueId: string,
  name: string,
  template: LayoutTemplateId,
  opts?: { capacity?: number },
) {
  const mapData = generateLayoutTemplate(template, {
    idPrefix: `${venueId.slice(-8)}-${template}`,
    capacity: opts?.capacity,
  });

  let layout = await prisma.venueLayout.findFirst({
    where: { venueId, name },
    include: { sections: { include: { seats: true, rows: true } } },
  });

  if (!layout) {
    layout = await prisma.venueLayout.create({
      data: {
        venueId,
        name,
        isActive: true,
        mapData: mapData as object,
      },
      include: { sections: { include: { seats: true, rows: true } } },
    });
  }

  // Replace sections/seats for deterministic demo maps
  await prisma.seat.deleteMany({ where: { section: { layoutId: layout.id } } });
  await prisma.seatRow.deleteMany({ where: { section: { layoutId: layout.id } } });
  await prisma.section.deleteMany({ where: { layoutId: layout.id } });

  for (let i = 0; i < mapData.sections.length; i++) {
    const sec = mapData.sections[i];
    const section = await prisma.section.create({
      data: {
        id: sec.id,
        layoutId: layout.id,
        name: sec.name,
        slug: sec.slug,
        color: sec.color,
        sortOrder: i,
      },
    });

    const rowLabels = Array.from(
      new Set(sec.seats.map((s) => s.row || s.label.split('-')[0] || 'A')),
    );
    const rowIds = new Map<string, string>();
    for (let ri = 0; ri < rowLabels.length; ri++) {
      const row = await prisma.seatRow.create({
        data: { sectionId: section.id, label: rowLabels[ri], sortOrder: ri },
      });
      rowIds.set(rowLabels[ri], row.id);
    }

    for (const seat of sec.seats) {
      const rowLabel = seat.row || seat.label.split('-')[0] || 'A';
      await prisma.seat.create({
        data: {
          id: seat.id,
          sectionId: section.id,
          rowId: rowIds.get(rowLabel),
          label: seat.label,
          x: seat.x,
          y: seat.y,
          rotation: seat.rotation ?? 0,
          tier: seat.tier ?? 'standard',
        },
      });
    }
  }

  const refreshed = await prisma.venueLayout.findFirstOrThrow({
    where: { id: layout.id },
    include: { sections: { include: { seats: { include: { row: true } } }, orderBy: { sortOrder: 'asc' } } },
  });

  const snapshot: SeatMapData = {
    version: 2,
    sections: refreshed.sections.map((sec) => ({
      id: sec.id,
      name: sec.name,
      slug: sec.slug,
      color: sec.color,
      seats: sec.seats.map((s) => ({
        id: s.id,
        label: s.label,
        x: s.x,
        y: s.y,
        rotation: s.rotation,
        tier: s.tier ?? 'standard',
        row: s.row?.label ?? s.label.split('-')[0],
      })),
    })),
    viewport: mapData.viewport,
  };

  await prisma.venueLayout.update({
    where: { id: layout.id },
    data: { mapData: snapshot as object, isActive: true },
  });

  return { layout: refreshed, snapshot };
}

async function main() {
  const passwordHash = await bcrypt.hash('Admin123!', 10);

  const org = await prisma.organization.upsert({
    where: { slug: 'demo-boletera' },
    update: {},
    create: {
      name: 'Demo Boletera',
      slug: 'demo-boletera',
      email: 'admin@demo.boletera.com',
      country: 'MX',
      timezone: 'America/Mexico_City',
      currency: Currency.MXN,
      type: OrgType.BOLETERA,
      verified: true,
      tenantTheme: {
        create: {
          primaryColor: '#171717',
          secondaryColor: '#737373',
          subdomain: 'demo',
        },
      },
    },
  });

  const admin = await prisma.user.upsert({
    where: { email: 'admin@demo.boletera.com' },
    update: {},
    create: {
      email: 'admin@demo.boletera.com',
      firstName: 'Admin',
      lastName: 'Demo',
      password: passwordHash,
      role: UserRole.SUPER_ADMIN,
      organizationId: org.id,
      emailVerified: true,
    },
  });

  const cashier = await prisma.user.upsert({
    where: { email: 'taquilla@demo.boletera.com' },
    update: {},
    create: {
      email: 'taquilla@demo.boletera.com',
      firstName: 'Cajero',
      lastName: 'Demo',
      password: passwordHash,
      role: UserRole.TAQUILLA,
      organizationId: org.id,
      emailVerified: true,
    },
  });

  const customer = await prisma.user.upsert({
    where: { email: 'cliente@demo.boletera.com' },
    update: {},
    create: {
      email: 'cliente@demo.boletera.com',
      firstName: 'Cliente',
      lastName: 'Demo',
      password: passwordHash,
      role: UserRole.CUSTOMER,
      emailVerified: true,
    },
  });

  const venue = await prisma.venue.upsert({
    where: { slug: 'arena-cdmx' },
    update: { totalCapacity: 500 },
    create: {
      organizationId: org.id,
      name: 'Arena CDMX',
      slug: 'arena-cdmx',
      address: 'Av. Constituyentes 947',
      city: 'Ciudad de México',
      state: 'CDMX',
      country: 'MX',
      timezone: 'America/Mexico_City',
      totalCapacity: 500,
      generalSeats: 500,
    },
  });

  const venueGdl = await prisma.venue.upsert({
    where: { slug: 'teatro-degollado' },
    update: { totalCapacity: 280 },
    create: {
      organizationId: org.id,
      name: 'Teatro Degollado',
      slug: 'teatro-degollado',
      address: 'Degollado s/n',
      city: 'Guadalajara',
      state: 'Jalisco',
      country: 'MX',
      timezone: 'America/Mexico_City',
      totalCapacity: 280,
      generalSeats: 280,
    },
  });

  const venueMty = await prisma.venue.upsert({
    where: { slug: 'arena-monterrey' },
    update: { totalCapacity: 400 },
    create: {
      organizationId: org.id,
      name: 'Arena Monterrey',
      slug: 'arena-monterrey',
      address: 'Av. Fundidora 501',
      city: 'Monterrey',
      state: 'NL',
      country: 'MX',
      timezone: 'America/Mexico_City',
      totalCapacity: 400,
      generalSeats: 400,
    },
  });

  const arena = await persistLayoutFromTemplate(venue.id, 'Layout Arena', 'arena', {
    capacity: 200,
  });
  const theater = await persistLayoutFromTemplate(venueGdl.id, 'Layout Teatro', 'theater', {
    capacity: 160,
  });
  const stadium = await persistLayoutFromTemplate(venueMty.id, 'Layout Estadio', 'stadium', {
    capacity: 280,
  });

  // Festival map stored as alternate active snapshot generator (per-event override)
  const festivalMap = generateLayoutTemplate('festival', {
    idPrefix: `${venue.id.slice(-8)}-fest`,
    capacity: 180,
  });

  async function ensureEvent(opts: {
    slug: string;
    title: string;
    description: string;
    category: 'MUSIC' | 'SPORTS' | 'THEATER' | 'COMEDY' | 'FESTIVAL';
    venueId: string;
    startsAt: Date;
    price: number;
    withSeats?: boolean;
    offerName?: string;
    image?: string;
    layoutId: string;
    snapshot: SeatMapData;
    posterAspect?: string;
  }) {
    const totalSeats = opts.snapshot.sections.reduce((n, s) => n + s.seats.length, 0);
    const meta = { posterAspect: opts.posterAspect ?? '3/4' };
    const event = await prisma.event.upsert({
      where: { slug: opts.slug },
      update: {
        title: opts.title,
        description: opts.description,
        category: opts.category,
        venueId: opts.venueId,
        startsAt: opts.startsAt,
        status: EventStatus.SCHEDULED,
        publishedAt: new Date(),
        minPrice: opts.price,
        maxPrice: opts.price * 2,
        image: opts.image,
        bannerImage: opts.image,
        totalCapacity: totalSeats || 80,
        metadata: meta,
      },
      create: {
        organizationId: org.id,
        venueId: opts.venueId,
        title: opts.title,
        description: opts.description,
        slug: opts.slug,
        category: opts.category,
        startsAt: opts.startsAt,
        timezone: 'America/Mexico_City',
        status: EventStatus.SCHEDULED,
        publishedAt: new Date(),
        totalCapacity: totalSeats || 80,
        minPrice: opts.price,
        maxPrice: opts.price * 2,
        currency: Currency.MXN,
        image: opts.image,
        bannerImage: opts.image,
        metadata: meta,
      },
    });

    await prisma.eventSeatMap.upsert({
      where: { eventId: event.id },
      create: {
        eventId: event.id,
        layoutId: opts.layoutId,
        snapshotData: opts.snapshot as object,
        publishedAt: new Date(),
      },
      update: {
        layoutId: opts.layoutId,
        snapshotData: opts.snapshot as object,
        publishedAt: new Date(),
      },
    });

    // Refresh offers + tickets from snapshot sections
    await prisma.ticket.deleteMany({ where: { eventId: event.id } });
    await prisma.seatHold.deleteMany({ where: { eventId: event.id } }).catch(() => undefined);

    if (opts.withSeats !== false && opts.snapshot.sections.length) {
      for (const section of opts.snapshot.sections) {
        const tier = section.seats[0]?.tier ?? 'standard';
        const priceMul = tier === 'premium' ? 1.4 : tier === 'economy' ? 0.75 : 1;
        const price = Math.round(opts.price * priceMul);
        const qty = section.seats.length;
        const offer = await prisma.offer.upsert({
          where: { eventId_zone: { eventId: event.id, zone: section.slug } },
          update: {
            name: section.name,
            basePrice: price,
            totalQuantity: qty,
            remainingQuantity: qty,
            isAvailable: true,
          },
          create: {
            eventId: event.id,
            name: section.name,
            zone: section.slug,
            basePrice: price,
            totalQuantity: qty,
            remainingQuantity: qty,
            startDate: new Date(),
            endDate: opts.startsAt,
            isAvailable: true,
          },
        });

        for (const seat of section.seats) {
          const seatExists = await prisma.seat.findUnique({ where: { id: seat.id } });
          await prisma.ticket.create({
            data: {
              code: `TKT-${opts.slug.slice(0, 6).toUpperCase()}-${seat.id.replace(/[^a-zA-Z0-9]/g, '').slice(-10).toUpperCase()}`,
              eventId: event.id,
              offerId: offer.id,
              status: TicketStatus.AVAILABLE,
              seatId: seatExists ? seat.id : undefined,
              seatNumber: seat.label.includes('-') ? seat.label.split('-').pop() : seat.label,
              row: seat.row || 'A',
              section: section.name,
            },
          });
        }
      }
    } else {
      const offer = await prisma.offer.upsert({
        where: { eventId_zone: { eventId: event.id, zone: 'ga' } },
        update: {
          name: opts.offerName ?? 'General',
          basePrice: opts.price,
          totalQuantity: 80,
          remainingQuantity: 80,
          isAvailable: true,
        },
        create: {
          eventId: event.id,
          name: opts.offerName ?? 'General',
          zone: 'ga',
          basePrice: opts.price,
          totalQuantity: 80,
          remainingQuantity: 80,
          startDate: new Date(),
          endDate: opts.startsAt,
        },
      });
      for (let i = 1; i <= 24; i++) {
        await prisma.ticket.create({
          data: {
            code: `GA-${opts.slug.slice(0, 6).toUpperCase()}-${String(i).padStart(3, '0')}`,
            eventId: event.id,
            offerId: offer.id,
            status: TicketStatus.AVAILABLE,
            seatNumber: String(i),
            row: 'GA',
            section: 'GA',
          },
        });
      }
    }

    return event;
  }

  const inDays = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    d.setHours(20, 0, 0, 0);
    return d;
  };

  const IMG = {
    demo: '/posters/concierto-demo-2026.svg',
    indie: '/posters/noche-indie-cdmx.svg',
    standup: '/posters/stand-up-gdl.svg',
    obra: '/posters/obra-clasica-gdl.svg',
    clasico: '/posters/clasico-regio.svg',
    verano: '/posters/festival-verano-mty.svg',
    electro: '/posters/electro-night-cdmx.svg',
    ballet: '/posters/ballet-gdl.svg',
    final: '/posters/final-regional-mty.svg',
    comedia: '/posters/comedia-abierta-cdmx.svg',
    jazz: '/posters/jazz-al-atardecer.svg',
    openair: '/posters/open-air-fest-cdmx.svg',
  };

  const event = await ensureEvent({
    slug: 'concierto-demo-2026',
    title: 'Concierto Demo 2026',
    description:
      'Show demo con mapa de asientos en vivo. Ideal para probar hold, checkout Banorte y boleto QR.',
    category: 'MUSIC',
    venueId: venue.id,
    startsAt: inDays(28),
    price: 800,
    withSeats: true,
    offerName: 'Sección A',
    image: IMG.demo,
    layoutId: arena.layout.id,
    snapshot: arena.snapshot,
    posterAspect: '3/4',
  });

  const catalog = await Promise.all([
    ensureEvent({
      slug: 'noche-indie-cdmx',
      title: 'Noche Indie CDMX',
      description: 'Tres bandas emergentes en una noche íntima. Doors 19:00 · show 20:00.',
      category: 'MUSIC',
      venueId: venue.id,
      startsAt: inDays(3),
      price: 450,
      withSeats: true,
      image: IMG.indie,
      layoutId: arena.layout.id,
      snapshot: arena.snapshot,
      posterAspect: '3/4',
    }),
    ensureEvent({
      slug: 'stand-up-gdl',
      title: 'Stand-up en Guadalajara',
      description: 'Rutina completa con invitados locales. Edad sugerida 16+.',
      category: 'COMEDY',
      venueId: venueGdl.id,
      startsAt: inDays(5),
      price: 320,
      withSeats: true,
      image: IMG.standup,
      layoutId: theater.layout.id,
      snapshot: theater.snapshot,
      posterAspect: '4/5',
    }),
    ensureEvent({
      slug: 'obra-clasica-gdl',
      title: 'Obra clásica — Teatro Degollado',
      description: 'Montaje de temporada en el Degollado. Código de vestimenta semi-formal.',
      category: 'THEATER',
      venueId: venueGdl.id,
      startsAt: inDays(12),
      price: 280,
      withSeats: true,
      image: IMG.obra,
      layoutId: theater.layout.id,
      snapshot: theater.snapshot,
      posterAspect: '2/3',
    }),
    ensureEvent({
      slug: 'clasico-regio',
      title: 'Clásico Regio',
      description: 'Partido de temporada regular. Acceso por torniquete con QR dinámico.',
      category: 'SPORTS',
      venueId: venueMty.id,
      startsAt: inDays(9),
      price: 550,
      withSeats: true,
      image: IMG.clasico,
      layoutId: stadium.layout.id,
      snapshot: stadium.snapshot,
      posterAspect: '1/1',
    }),
    ensureEvent({
      slug: 'festival-verano-mty',
      title: 'Festival de Verano MTY',
      description: 'Jornada completa con escenarios principales y food court. Boleto de un día.',
      category: 'FESTIVAL',
      venueId: venueMty.id,
      startsAt: inDays(18),
      price: 990,
      withSeats: true,
      image: IMG.verano,
      layoutId: stadium.layout.id,
      snapshot: generateLayoutTemplate('festival', {
        idPrefix: `${venueMty.id.slice(-8)}-fest`,
      }),
      posterAspect: '16/9',
    }),
    ensureEvent({
      slug: 'electro-night-cdmx',
      title: 'Electro Night CDMX',
      description: 'Set continuo hasta tarde. Política de reingreso no aplica.',
      category: 'MUSIC',
      venueId: venue.id,
      startsAt: inDays(6),
      price: 620,
      withSeats: true,
      image: IMG.electro,
      layoutId: arena.layout.id,
      snapshot: arena.snapshot,
      posterAspect: '3/4',
    }),
    ensureEvent({
      slug: 'ballet-gdl',
      title: 'Ballet Contemporáneo',
      description: 'Compañía residente. Duración aprox. 95 min con intermedio.',
      category: 'THEATER',
      venueId: venueGdl.id,
      startsAt: inDays(4),
      price: 380,
      withSeats: true,
      image: IMG.ballet,
      layoutId: theater.layout.id,
      snapshot: theater.snapshot,
      posterAspect: '2/3',
    }),
    ensureEvent({
      slug: 'final-regional-mty',
      title: 'Final Regional',
      description: 'Eliminatoria a partido único. Llegar 60 min antes por filtros de seguridad.',
      category: 'SPORTS',
      venueId: venueMty.id,
      startsAt: inDays(2),
      price: 720,
      withSeats: true,
      image: IMG.final,
      layoutId: stadium.layout.id,
      snapshot: stadium.snapshot,
      posterAspect: '1/1',
    }),
    ensureEvent({
      slug: 'comedia-abierta-cdmx',
      title: 'Comedia Abierta',
      description: 'Micrófono abierto + headliner. Barra disponible en venue.',
      category: 'COMEDY',
      venueId: venue.id,
      startsAt: inDays(11),
      price: 250,
      withSeats: true,
      image: IMG.comedia,
      layoutId: arena.layout.id,
      snapshot: arena.snapshot,
      posterAspect: '4/5',
    }),
    ensureEvent({
      slug: 'jazz-al-atardecer',
      title: 'Jazz al Atardecer',
      description: 'Quinteto en vivo al atardecer. Asientos numerados limitados.',
      category: 'MUSIC',
      venueId: venueGdl.id,
      startsAt: inDays(15),
      price: 410,
      withSeats: true,
      image: IMG.jazz,
      layoutId: theater.layout.id,
      snapshot: theater.snapshot,
      posterAspect: '3/4',
    }),
    ensureEvent({
      slug: 'open-air-fest-cdmx',
      title: 'Open Air Fest',
      description: 'Festival al aire libre con lineup multi-género. Incluye acceso a zonas comunes.',
      category: 'FESTIVAL',
      venueId: venue.id,
      startsAt: inDays(21),
      price: 1250,
      withSeats: true,
      image: IMG.openair,
      layoutId: arena.layout.id,
      snapshot: festivalMap,
      posterAspect: '16/9',
    }),
  ]);

  console.log('Seed OK:', {
    org: org.slug,
    admin: admin.email,
    cashier: cashier.email,
    customer: customer.email,
    layouts: {
      arena: arena.snapshot.sections.map((s) => `${s.name}:${s.seats.length}`),
      theater: theater.snapshot.sections.map((s) => `${s.name}:${s.seats.length}`),
      stadium: stadium.snapshot.sections.map((s) => `${s.name}:${s.seats.length}`),
    },
    events: [event.slug, ...catalog.map((e) => e.slug)],
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
