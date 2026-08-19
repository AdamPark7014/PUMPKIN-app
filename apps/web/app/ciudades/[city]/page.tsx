import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { Breadcrumbs } from '@/components/storefront/Breadcrumbs';
import { EventCard } from '@/components/storefront/EventCard';
import { JsonLd } from '@/components/storefront/JsonLd';
import { apiCachedSafe, REVALIDATE } from '@/lib/api';
import { CATEGORY_LABEL, categoryLabel, plural } from '@/lib/format';
import { canonical, eventListJsonLd, SITE_NAME } from '@/lib/seo';
import type { DiscoveryFacets, EventListItem } from '@/lib/storefront-types';
import styles from '../../hub.module.scss';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string }>;
}): Promise<Metadata> {
  const { city: raw } = await params;
  const city = decodeURIComponent(raw);
  const title = `Eventos en ${city}`;
  const description = `Cartelera oficial en ${city}. Compra boletos con inventario real y pago Banorte.`;
  const path = `/ciudades/${encodeURIComponent(city)}`;
  const url = canonical(path);

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
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
    alternates: { canonical: url },
  };
}

export default async function CiudadPage({
  params,
}: {
  params: Promise<{ city: string }>;
}) {
  const { city: raw } = await params;
  const city = decodeURIComponent(raw);

  const [eventsRaw, facets] = await Promise.all([
    apiCachedSafe<EventListItem[]>(
      `/discovery/events?city=${encodeURIComponent(city)}&limit=60`,
      REVALIDATE.listing,
      [`discovery-city-${city}`],
    ),
    apiCachedSafe<DiscoveryFacets>('/discovery/facets', REVALIDATE.facets, ['discovery-facets']),
  ]);

  const events = [...(eventsRaw ?? [])].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );

  const venueMap = new Map<string, { slug: string; name: string }>();
  const categoryKeys = new Set<string>();
  for (const event of events) {
    if (event.category && event.category in CATEGORY_LABEL) {
      categoryKeys.add(event.category);
    }
    const venue = event.venue;
    if (venue?.slug && venue.name && !venueMap.has(venue.slug)) {
      venueMap.set(venue.slug, { slug: venue.slug, name: venue.name });
    }
  }
  const venues = [...venueMap.values()].slice(0, 8);
  const categories = [...categoryKeys].slice(0, 6);
  const otherCities = (facets?.cities ?? [])
    .filter((c) => c.name.toLowerCase() !== city.toLowerCase())
    .slice(0, 6);

  const trail = [
    { name: 'Cartelera', path: '/' },
    { name: 'Ciudades', path: '/ciudades' },
    { name: city },
  ] as const;

  return (
    <>
      <SiteHeader theme="dark" />
      <main className={styles.page}>
        <Breadcrumbs trail={trail} />
        {events.length > 0 && (
          <JsonLd data={eventListJsonLd(events, `Eventos en ${city}`)} />
        )}

        <header className={styles.hero}>
          <h1>{city}</h1>
          <p>
            {plural(events.length, 'evento')} disponible
            {events.length === 1 ? '' : 's'} · boletos oficiales
          </p>
        </header>

        {events.length === 0 ? (
          <div className={styles.empty}>
            <p>Sin eventos publicados en {city} por ahora.</p>
            <div className={styles.emptyLinks}>
              <Link href="/ciudades">Otras ciudades</Link>
              <Link href="/">Ver cartelera</Link>
              <Link href="/venues">Ver recintos</Link>
            </div>
          </div>
        ) : (
          <ul className={styles.grid}>
            {events.map((event) => (
              <li key={event.id}>
                <EventCard event={event} showVenue />
              </li>
            ))}
          </ul>
        )}

        {venues.length > 0 && (
          <section className={styles.section} aria-labelledby="city-venues">
            <h2 id="city-venues">Recintos en {city}</h2>
            <ul className={styles.chipRow}>
              {venues.map((v) => (
                <li key={v.slug}>
                  <Link href={`/venues/${v.slug}`} className={styles.chip}>
                    {v.name}
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/venues" className={styles.chip}>
                  Todos los recintos
                </Link>
              </li>
            </ul>
          </section>
        )}

        {categories.length > 0 && (
          <section className={styles.section} aria-labelledby="city-cats">
            <h2 id="city-cats">Categorías</h2>
            <ul className={styles.chipRow}>
              {categories.map((key) => (
                <li key={key}>
                  <Link
                    href={`/categoria/${key.toLowerCase()}`}
                    className={styles.chip}
                  >
                    {categoryLabel(key)}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {otherCities.length > 0 && (
          <section className={styles.section} aria-labelledby="city-more">
            <h2 id="city-more">Otras ciudades</h2>
            <ul className={styles.chipRow}>
              {otherCities.map((c) => (
                <li key={c.name}>
                  <Link
                    href={`/ciudades/${encodeURIComponent(c.name)}`}
                    className={styles.chip}
                  >
                    {c.name}
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/ciudades" className={styles.chip}>
                  Ver todas
                </Link>
              </li>
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
