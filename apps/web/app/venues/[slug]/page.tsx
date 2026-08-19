import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/SiteHeader';
import { Breadcrumbs } from '@/components/storefront/Breadcrumbs';
import { EventCard } from '@/components/storefront/EventCard';
import { JsonLd } from '@/components/storefront/JsonLd';
import { apiCachedSafe, REVALIDATE } from '@/lib/api';
import { categoryLabel, count, plural } from '@/lib/format';
import {
  absoluteUrl,
  canonical,
  eventListJsonLd,
  mapsUrl,
  SITE_NAME,
  venueJsonLd,
} from '@/lib/seo';
import type { VenueDetail } from '@/lib/storefront-types';
import styles from '../../hub.module.scss';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const venue = await apiCachedSafe<VenueDetail>(
    `/discovery/venues/${encodeURIComponent(slug)}`,
    REVALIDATE.facets,
    [`discovery-venue-${slug}`],
  );

  if (!venue) {
    return { title: 'Recinto no encontrado' };
  }

  const place = [venue.city, venue.state].filter(Boolean).join(', ');
  const title = `${venue.name} — boletos y eventos`;
  const description =
    venue.description?.slice(0, 155) ||
    `Próximos eventos en ${venue.name}${place ? `, ${place}` : ''}. Compra boletos oficiales en ${SITE_NAME}.`;
  const path = `/venues/${venue.slug}`;
  const url = canonical(path);
  const image = absoluteUrl(venue.image);

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url,
      type: 'website',
      locale: 'es_MX',
      siteName: SITE_NAME,
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
}

export default async function VenuePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const venue = await apiCachedSafe<VenueDetail>(
    `/discovery/venues/${encodeURIComponent(slug)}`,
    REVALIDATE.facets,
    [`discovery-venue-${slug}`],
  );

  if (!venue) notFound();

  const events = [...(venue.events ?? [])].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );

  const directions = mapsUrl({
    name: venue.name,
    address: venue.address,
    city: venue.city,
    latitude: venue.latitude,
    longitude: venue.longitude,
  });

  const categoryKeys = [
    ...new Set(
      events
        .map((e) => e.category)
        .filter((c): c is string => typeof c === 'string' && c.length > 0),
    ),
  ].slice(0, 6);

  const trail = [
    { name: 'Cartelera', path: '/' },
    { name: 'Recintos', path: '/venues' },
    { name: venue.name },
  ] as const;

  const placeLabel = [venue.city, venue.state].filter(Boolean).join(', ');

  return (
    <>
      <SiteHeader theme="dark" />
      <main className={styles.page}>
        <Breadcrumbs trail={trail} />
        <JsonLd
          data={[
            venueJsonLd(venue),
            ...(events.length > 0
              ? [eventListJsonLd(events, `Próximos eventos en ${venue.name}`)]
              : []),
          ]}
        />

        <header className={styles.hero}>
          <h1>{venue.name}</h1>
          <p>
            {placeLabel}
            {events.length > 0
              ? ` · ${plural(events.length, 'próximo evento', 'próximos eventos')}`
              : ''}
          </p>
        </header>

        <section className={styles.metaBlock} aria-label="Datos del recinto">
          <p>
            <strong>Dirección:</strong> {venue.address}
            {venue.postalCode ? ` · CP ${venue.postalCode}` : ''}
            {placeLabel ? ` · ${placeLabel}` : ''}
          </p>
          {venue.description ? <p>{venue.description}</p> : null}
          {typeof venue.totalCapacity === 'number' && venue.totalCapacity > 0 ? (
            <p>
              <strong>Capacidad:</strong> {count(venue.totalCapacity)} personas
            </p>
          ) : null}
          {venue.phone ? (
            <p>
              <strong>Teléfono:</strong>{' '}
              <a href={`tel:${venue.phone.replace(/\s+/g, '')}`}>{venue.phone}</a>
            </p>
          ) : null}
          <div className={styles.metaActions}>
            <a href={directions} target="_blank" rel="noopener noreferrer">
              Cómo llegar
            </a>
            {venue.website ? (
              <a href={venue.website} target="_blank" rel="noopener noreferrer">
                Sitio del recinto
              </a>
            ) : null}
            {venue.city ? (
              <Link href={`/ciudades/${encodeURIComponent(venue.city)}`}>
                Eventos en {venue.city}
              </Link>
            ) : null}
          </div>
        </section>

        <section className={styles.section} aria-labelledby="venue-events">
          <h2 id="venue-events">Próximos eventos</h2>
          {events.length === 0 ? (
            <div className={styles.empty}>
              <p>Sin eventos programados en este recinto.</p>
              <div className={styles.emptyLinks}>
                <Link href="/venues">Otros recintos</Link>
                <Link href="/">Ver cartelera</Link>
                {venue.city ? (
                  <Link href={`/ciudades/${encodeURIComponent(venue.city)}`}>
                    Eventos en {venue.city}
                  </Link>
                ) : null}
              </div>
            </div>
          ) : (
            <ul className={styles.grid}>
              {events.map((event) => (
                <li key={event.id}>
                  <EventCard event={event} showVenue={false} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {categoryKeys.length > 0 && (
          <section className={styles.section} aria-labelledby="venue-cats">
            <h2 id="venue-cats">Categorías en cartelera</h2>
            <ul className={styles.chipRow}>
              {categoryKeys.map((key) => (
                <li key={key}>
                  <Link
                    href={`/categoria/${key.toLowerCase()}`}
                    className={styles.chip}
                  >
                    {categoryLabel(key)}
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/ciudades" className={styles.chip}>
                  Ciudades
                </Link>
              </li>
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
