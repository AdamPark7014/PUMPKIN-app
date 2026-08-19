import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/SiteHeader';
import { Breadcrumbs } from '@/components/storefront/Breadcrumbs';
import { EventCard } from '@/components/storefront/EventCard';
import { JsonLd } from '@/components/storefront/JsonLd';
import { apiCachedSafe, REVALIDATE } from '@/lib/api';
import { CATEGORY_LABEL, categoryLabel, plural } from '@/lib/format';
import { canonical, eventListJsonLd, SITE_NAME } from '@/lib/seo';
import type { DiscoveryFacets, EventListItem } from '@/lib/storefront-types';
import styles from '../../hub.module.scss';

const ALLOWED = new Set(Object.keys(CATEGORY_LABEL));

function normalizeKey(raw: string): string {
  return decodeURIComponent(raw).toUpperCase();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ key: string }>;
}): Promise<Metadata> {
  const { key: raw } = await params;
  const key = normalizeKey(raw);
  if (!ALLOWED.has(key)) {
    return { title: 'Categoría no encontrada' };
  }

  const label = categoryLabel(key);
  const title = `${label} — boletos oficiales`;
  const description = `Cartelera de ${label.toLowerCase()} en México. Compra boletos oficiales con inventario real y pago Banorte.`;
  const path = `/categoria/${key.toLowerCase()}`;
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

export default async function CategoriaPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key: raw } = await params;
  const key = normalizeKey(raw);
  if (!ALLOWED.has(key)) notFound();

  const label = categoryLabel(key);

  const [eventsRaw, facets] = await Promise.all([
    apiCachedSafe<EventListItem[]>(
      `/discovery/events?category=${encodeURIComponent(key)}&limit=60`,
      REVALIDATE.listing,
      [`discovery-category-${key}`],
    ),
    apiCachedSafe<DiscoveryFacets>('/discovery/facets', REVALIDATE.facets, ['discovery-facets']),
  ]);

  const events = [...(eventsRaw ?? [])].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );

  const cities = (facets?.cities ?? []).slice(0, 8);
  const otherCategories = (facets?.categories ?? [])
    .filter((c) => c.key.toUpperCase() !== key && ALLOWED.has(c.key.toUpperCase()))
    .slice(0, 6);

  const trail = [
    { name: 'Cartelera', path: '/' },
    { name: label },
  ] as const;

  return (
    <>
      <SiteHeader theme="dark" />
      <main className={styles.page}>
        <Breadcrumbs trail={trail} />
        {events.length > 0 && (
          <JsonLd data={eventListJsonLd(events, `${label} en ${SITE_NAME}`)} />
        )}

        <header className={styles.hero}>
          <h1>{label}</h1>
          <p>
            {plural(events.length, 'evento')} en cartelera · boletos oficiales
          </p>
        </header>

        {events.length === 0 ? (
          <div className={styles.empty}>
            <p>No hay eventos publicados en esta categoría por ahora.</p>
            <div className={styles.emptyLinks}>
              <Link href="/">Ver cartelera</Link>
              <Link href="/ciudades">Explorar ciudades</Link>
              <Link href="/venues">Ver recintos</Link>
            </div>
          </div>
        ) : (
          <ul className={styles.grid}>
            {events.map((event) => (
              <li key={event.id}>
                <EventCard event={event} />
              </li>
            ))}
          </ul>
        )}

        {cities.length > 0 && (
          <section className={styles.section} aria-labelledby="cat-cities">
            <h2 id="cat-cities">Por ciudad</h2>
            <ul className={styles.chipRow}>
              {cities.map((c) => (
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
                  Todas las ciudades
                </Link>
              </li>
            </ul>
          </section>
        )}

        {otherCategories.length > 0 && (
          <section className={styles.section} aria-labelledby="cat-more">
            <h2 id="cat-more">Otras categorías</h2>
            <ul className={styles.chipRow}>
              {otherCategories.map((c) => (
                <li key={c.key}>
                  <Link
                    href={`/categoria/${c.key.toLowerCase()}`}
                    className={styles.chip}
                  >
                    {categoryLabel(c.key)}
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/venues" className={styles.chip}>
                  Recintos
                </Link>
              </li>
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
