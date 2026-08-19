import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/SiteHeader';
import { EventPosterArt } from '@/components/EventPosterArt';
import { WaitlistSignup } from '@/components/WaitlistSignup';
import { ZoneOfferButtons } from '@/components/ZoneOfferButtons';
import { AvailabilityBadge } from '@/components/storefront/AvailabilityBadge';
import { Breadcrumbs } from '@/components/storefront/Breadcrumbs';
import { EventCard } from '@/components/storefront/EventCard';
import { JsonLd } from '@/components/storefront/JsonLd';
import { PriceBreakdown } from '@/components/storefront/PriceBreakdown';
import {
  TRUST_OFFICIAL,
  TRUST_QR,
  TrustRow,
  trustPayment,
  trustTransfer,
} from '@/components/storefront/TrustRow';
import { apiCached, apiCachedSafe, apiSafe, REVALIDATE } from '@/lib/api';
import {
  categoryLabel,
  fromPrice,
  longDateTime,
  money,
  timeOfDay,
  toAmount,
} from '@/lib/format';
import {
  absoluteUrl,
  canonical,
  eventJsonLd,
  mapsUrl,
  SITE_NAME,
} from '@/lib/seo';
import type {
  CartPricing,
  EventDetail,
  EventListItem,
  GatewayConfig,
} from '@/lib/storefront-types';
import { SALE_STATE_MESSAGE } from '@/lib/storefront-types';
import { EventPurchaseClient } from './EventPurchaseClient';
import styles from './event.module.scss';

async function loadEvent(slug: string): Promise<EventDetail> {
  try {
    return await apiCached<EventDetail>(
      `/discovery/events/${slug}`,
      REVALIDATE.event,
      [`event:${slug}`],
    );
  } catch {
    notFound();
  }
  // Unreachable — notFound() never returns — keeps TS definite-assignment happy.
  throw new Error('unreachable');
}

async function loadRelated(event: EventDetail, slug: string): Promise<EventListItem[]> {
  const all = await apiCachedSafe<EventListItem[]>(
    '/discovery/events?limit=40',
    REVALIDATE.listing,
    ['events:listing'],
  );
  if (!all?.length) return [];

  const others = all.filter((e) => e.slug !== slug);
  const matched = others
    .filter(
      (e) =>
        (event.category && e.category === event.category) ||
        (event.venue?.city && e.venue?.city === event.venue.city),
    )
    .slice(0, 4);

  if (matched.length >= 3) return matched;
  return others.slice(0, 4);
}

/** Sample fee quote for 1 boleto of the cheapest available offer — never invents numbers. */
async function samplePricing(event: EventDetail): Promise<CartPricing | null> {
  const offer =
    event.offers
      .filter((o) => {
        if (o.isAvailable === false) return false;
        if (typeof o.remainingQuantity === 'number' && o.remainingQuantity <= 0) return false;
        return toAmount(o.basePrice) > 0;
      })
      .sort((a, b) => toAmount(a.basePrice) - toAmount(b.basePrice))[0] ?? event.offers[0];

  if (!offer || !event.sale?.canPurchase) return null;

  return apiSafe<CartPricing>('/pricing/calculate-cart', {
    method: 'POST',
    body: JSON.stringify({
      eventId: event.id,
      items: [{ offerId: offer.id, quantity: 1 }],
    }),
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  try {
    const event = await apiCached<EventDetail>(
      `/discovery/events/${slug}`,
      REVALIDATE.event,
      [`event:${slug}`],
    );
    const venue = [event.venue?.name, event.venue?.city].filter(Boolean).join(', ');
    const title = `${event.title} | Boletos oficiales`;
    const description =
      event.description?.slice(0, 155) ||
      `Compra boletos oficiales para ${event.title}${venue ? ` en ${venue}` : ''} · ${longDateTime(event.startsAt)}.`;
    const image = absoluteUrl(event.bannerImage || event.image);
    const url = canonical(`/events/${slug}`);
    return {
      title,
      description,
      openGraph: {
        title,
        description,
        url,
        siteName: SITE_NAME,
        type: 'website',
        locale: 'es_MX',
        images: image ? [{ url: image }] : undefined,
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description,
        images: image ? [image] : undefined,
      },
      alternates: { canonical: url },
    };
  } catch {
    return { title: `Evento | ${SITE_NAME}` };
  }
}

export default async function EventPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ zone?: string }>;
}) {
  const { slug } = await params;
  const { zone } = await searchParams;
  const event = await loadEvent(slug);
  const [related, feeSample, payments] = await Promise.all([
    loadRelated(event, slug),
    samplePricing(event),
    apiSafe<GatewayConfig>('/payments/config'),
  ]);

  const currency = event.currency || 'MXN';
  const prices = event.offers
    .map((o) => toAmount(o.basePrice))
    .filter((n) => Number.isFinite(n) && n > 0);
  const minPrice = prices.length ? Math.min(...prices) : 0;

  const transferAllowed =
    !(event.transferAllowed === false || event.nonTransferable);
  const canPurchase = event.sale?.canPurchase ?? true;
  const saleState = event.sale?.state;
  const saleMessage = saleState ? SALE_STATE_MESSAGE[saleState] : null;

  const remainingKnown = event.offers
    .map((o) => o.remainingQuantity)
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  const totalRemaining =
    remainingKnown.length > 0 ? remainingKnown.reduce((a, b) => a + b, 0) : null;

  const poster = {
    id: event.id,
    slug: event.slug,
    title: event.title,
    category: event.category,
    image: event.image,
    bannerImage: event.bannerImage,
    startsAt: event.startsAt,
    posterAspect:
      event.posterAspect ?? event.metadata?.posterAspect ?? undefined,
  };

  const crumbTrail = [
    { name: 'Cartelera', path: '/' },
    ...(event.category
      ? [
          {
            name: categoryLabel(event.category),
            path: `/categoria/${event.category}`,
          },
        ]
      : []),
    { name: event.title },
  ];

  const holdMinutes = Math.round((event.holdExpiration ?? 900) / 60);
  const venueMaps =
    event.venue
      ? mapsUrl({
          name: event.venue.name,
          address: event.venue.address,
          city: event.venue.city,
          latitude: event.venue.latitude,
          longitude: event.venue.longitude,
        })
      : null;

  const soldOut =
    event.offers.length > 0 &&
    totalRemaining === 0 &&
    remainingKnown.length === event.offers.length;

  return (
    <>
      <JsonLd data={eventJsonLd(event)} />
      <SiteHeader theme="dark" />
      <main className={styles.page}>
        <section className={styles.hero}>
          <div className={styles.heroMedia}>
            <EventPosterArt event={poster} size="hero" />
          </div>
          <div className={styles.heroShade} aria-hidden />
          <div className={styles.heroCopy}>
            <Breadcrumbs trail={crumbTrail} tone="dark" />
            <p className={styles.brandMark}>{SITE_NAME}</p>
            <p className={styles.eyebrow}>
              {categoryLabel(event.category, true)}
              {event.organization?.name ? ` · ${event.organization.name}` : ''}
            </p>
            <h1>{event.title}</h1>
            <p className={styles.meta}>
              <time dateTime={event.startsAt}>{longDateTime(event.startsAt)}</time>
            </p>
            {event.venue && (
              <p className={styles.venue}>
                {venueMaps ? (
                  <a href={venueMaps} target="_blank" rel="noreferrer">
                    {event.venue.name}
                    {event.venue.city ? ` · ${event.venue.city}` : ''}
                  </a>
                ) : (
                  <>
                    {event.venue.name}
                    {event.venue.city ? ` · ${event.venue.city}` : ''}
                  </>
                )}
              </p>
            )}
            <div className={styles.heroCta}>
              {canPurchase && !soldOut ? (
                <a href="#compra" className={styles.cta}>
                  Comprar boletos
                </a>
              ) : (
                <span className={styles.ctaMuted} role="status">
                  {soldOut ? 'Agotado' : saleMessage ?? 'Venta no disponible'}
                </span>
              )}
              {minPrice > 0 && (
                <span className={styles.fromPrice}>{fromPrice(minPrice, currency)}</span>
              )}
              {totalRemaining != null && (
                <AvailabilityBadge remaining={totalRemaining} threshold={40} />
              )}
            </div>
          </div>
        </section>

        <div className={styles.trustWrap}>
          <TrustRow
            items={[
              TRUST_OFFICIAL,
              trustPayment(Boolean(payments?.demo)),
              TRUST_QR,
              trustTransfer(transferAllowed),
            ]}
          />
        </div>

        <div className={styles.shell}>
          <div className={styles.layout}>
            <div className={styles.mainCol}>
              {saleMessage && !canPurchase && (
                <div className={styles.saleBanner} role="status">
                  <strong>{saleMessage}</strong>
                  {event.sale?.nextChangeAt && (
                    <span>
                      Próximo cambio:{' '}
                      <time dateTime={event.sale.nextChangeAt}>
                        {longDateTime(event.sale.nextChangeAt)}
                      </time>
                    </span>
                  )}
                </div>
              )}

              {event.offers.length > 0 && (
                <section className={styles.offers} aria-label="Zonas y precios">
                  <h2>Zonas y precios</h2>
                  <p className={styles.sectionLead}>
                    Elige una zona para filtrar el mapa. Los precios base se muestran aquí;
                    los cargos de servicio e impuestos se confirman en el checkout.
                  </p>
                  <ZoneOfferButtons
                    offers={event.offers}
                    currency={currency}
                    activeZone={zone}
                    disabled={!canPurchase}
                  />
                  <div className={styles.feeNote}>
                    {feeSample ? (
                      <>
                        <p className={styles.feeLead}>
                          Ejemplo con 1 boleto · {money(feeSample.subtotal, currency)} + cargos
                        </p>
                        <PriceBreakdown pricing={feeSample} currency={currency} />
                      </>
                    ) : (
                      <p className={styles.feeLead}>
                        Los cargos de servicio e impuestos se calculan al ir al pago. Sin
                        sorpresas: verás el desglose completo antes de confirmar.
                      </p>
                    )}
                  </div>
                </section>
              )}

              <section className={styles.purchase} aria-label="Comprar" id="compra">
                <div className={styles.purchaseHead}>
                  <h2>
                    {soldOut || event.offers.length === 0
                      ? 'Lista de espera'
                      : 'Selecciona tus asientos'}
                  </h2>
                  {canPurchase && !soldOut && event.offers.length > 0 && (
                    <p className={styles.purchaseLead}>
                      Reserva hasta {holdMinutes} min mientras terminas el pago
                      {minPrice > 0 ? ` · ${fromPrice(minPrice, currency)}` : ''}
                    </p>
                  )}
                </div>

                {event.offers.length === 0 || soldOut ? (
                  <div className={styles.purchaseBody}>
                    <WaitlistSignup eventId={event.id} eventTitle={event.title} />
                  </div>
                ) : (
                  <EventPurchaseClient
                    eventId={event.id}
                    eventTitle={event.title}
                    slug={event.slug}
                    startsAt={event.startsAt}
                    venueName={event.venue?.name ?? undefined}
                    venueCity={event.venue?.city ?? undefined}
                    mapData={event.seatMap?.snapshotData}
                    offers={event.offers}
                    minPrice={minPrice}
                    currency={currency}
                    focusZone={zone ?? null}
                    canPurchase={canPurchase}
                    saleMessage={saleMessage}
                    maxTickets={event.maxTicketsPerOrder ?? 8}
                    holdMinutes={holdMinutes}
                  />
                )}
              </section>

              {event.description && (
                <section className={styles.about} aria-label="Acerca del evento">
                  <h2>Acerca del evento</h2>
                  <p>{event.description}</p>
                </section>
              )}

              <details className={styles.info} open>
                <summary>Políticas e información</summary>
                <ul>
                  {event.venue && (
                    <li>
                      <strong>Venue</strong>
                      <span>
                        {[
                          event.venue.name,
                          event.venue.address,
                          event.venue.city,
                          event.venue.state,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                        {venueMaps && (
                          <>
                            {' · '}
                            <a href={venueMaps} target="_blank" rel="noreferrer">
                              Cómo llegar
                            </a>
                          </>
                        )}
                      </span>
                    </li>
                  )}
                  {event.doorsAt && (
                    <li>
                      <strong>Apertura de puertas</strong>
                      <span>
                        <time dateTime={event.doorsAt}>{timeOfDay(event.doorsAt)}</time>
                      </span>
                    </li>
                  )}
                  {event.rating && (
                    <li>
                      <strong>Clasificación</strong>
                      <span>{event.rating}</span>
                    </li>
                  )}
                  {event.genre && (
                    <li>
                      <strong>Género</strong>
                      <span>{event.genre}</span>
                    </li>
                  )}
                  <li>
                    <strong>Reembolso</strong>
                    <span>
                      {event.refundable === false
                        ? 'No reembolsable'
                        : 'Sujeto a política del promotor'}
                    </span>
                  </li>
                  <li>
                    <strong>Transferencia</strong>
                    <span>
                      {transferAllowed
                        ? 'Transferencia permitida desde tu cuenta'
                        : 'No transferible'}
                    </span>
                  </li>
                  <li>
                    <strong>Reventa</strong>
                    <span>
                      {event.allowResale === false
                        ? 'Reventa no disponible'
                        : 'Reventa oficial permitida'}
                    </span>
                  </li>
                  <li>
                    <strong>Reserva</strong>
                    <span>
                      Los asientos se reservan {holdMinutes} minutos durante el checkout
                    </span>
                  </li>
                  {event.venue?.website && (
                    <li>
                      <strong>Sitio del venue</strong>
                      <span>
                        <a href={event.venue.website} target="_blank" rel="noreferrer">
                          {event.venue.website.replace(/^https?:\/\//, '')}
                        </a>
                      </span>
                    </li>
                  )}
                </ul>
              </details>
            </div>

            <aside className={styles.rail} aria-label="Resumen de compra">
              <div className={styles.railCard}>
                <div className={styles.railArt}>
                  <EventPosterArt event={poster} size="lg" showDate />
                </div>
                <p className={styles.railTitle}>{event.title}</p>
                <p className={styles.railMeta}>
                  {longDateTime(event.startsAt)}
                  {event.venue?.name ? (
                    <>
                      <br />
                      {event.venue.name}
                    </>
                  ) : null}
                </p>
                {minPrice > 0 && (
                  <p className={styles.railPrice}>{fromPrice(minPrice, currency)}</p>
                )}
                {canPurchase && !soldOut ? (
                  <a href="#compra" className={styles.cta}>
                    Ir a comprar
                  </a>
                ) : (
                  <p className={styles.railClosed} role="status">
                    {soldOut ? 'Agotado' : saleMessage ?? 'Venta cerrada'}
                  </p>
                )}
                <ul className={styles.railTrust}>
                  <li>Boletos oficiales</li>
                  <li>Pago Banorte</li>
                  <li>Entrada con QR</li>
                  <li>Hold {holdMinutes} min al elegir</li>
                  {event.organization?.name && (
                    <li>Organiza {event.organization.name}</li>
                  )}
                </ul>
              </div>
            </aside>
          </div>

          {related.length > 0 && (
            <section className={styles.related} aria-label="Más eventos">
              <div className={styles.relatedHead}>
                <h2>También te puede interesar</h2>
                <Link href="/" className={styles.relatedMore}>
                  Ver cartelera
                </Link>
              </div>
              <ul className={styles.relatedList}>
                {related.map((e) => (
                  <li key={e.id}>
                    <EventCard event={e} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </main>
    </>
  );
}
