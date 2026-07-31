import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { Breadcrumbs } from '@/components/storefront/Breadcrumbs';
import { JsonLd } from '@/components/storefront/JsonLd';
import { apiCachedSafe, REVALIDATE } from '@/lib/api';
import { categoryLabel, plural } from '@/lib/format';
import { canonical, SITE_NAME, type JsonLdObject } from '@/lib/seo';
import type { DiscoveryFacets, VenueListItem } from '@/lib/storefront-types';
import styles from '../hub.module.scss';

const TITLE = 'Recintos y arenas';
const DESCRIPTION =
  'Inmuebles con cartelera activa en BOLETERA. Encuentra tu recinto y compra boletos oficiales.';
const PATH = '/venues';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: canonical(PATH),
    type: 'website',
    locale: 'es_MX',
    siteName: SITE_NAME,
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
  alternates: { canonical: canonical(PATH) },
};

function venuesListJsonLd(venues: readonly VenueListItem[]): JsonLdObject {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Recintos con cartelera',
    numberOfItems: venues.length,
    itemListElement: venues.map((venue, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: venue.name,
      url: canonical(`/venues/${venue.slug}`),
    })),
  };
}

export default async function VenuesPage() {
  const [venuesRaw, facets] = await Promise.all([
    apiCachedSafe<VenueListItem[]>(
      '/discovery/venues?limit=40',
      REVALIDATE.facets,
      ['discovery-venues'],
    ),
    apiCachedSafe<DiscoveryFacets>('/discovery/facets', REVALIDATE.facets, ['discovery-facets']),
  ]);

  const venues = venuesRaw ?? [];
  const cities = (facets?.cities ?? []).slice(0, 8);
  const categories = (facets?.categories ?? []).slice(0, 6);

  const trail = [
    { name: 'Cartelera', path: '/' },
    { name: 'Recintos' },
  ] as const;

  return (
    <>
      <SiteHeader />
      <main className={styles.page}>
        <Breadcrumbs trail={trail} />
        {venues.length > 0 && <JsonLd data={venuesListJsonLd(venues)} />}

        <header className={styles.hero}>
          <h1>Inmuebles</h1>
          <p>
            {venues.length > 0
              ? `${plural(venues.length, 'recinto')} con cartelera activa.`
              : 'Recintos con cartelera activa en México.'}
          </p>
        </header>

        {venues.length === 0 ? (
          <div className={styles.empty}>
            <p>Sin recintos publicados por ahora.</p>
            <div className={styles.emptyLinks}>
              <Link href="/">Ver cartelera</Link>
              <Link href="/ciudades">Explorar ciudades</Link>
            </div>
          </div>
        ) : (
          <ul className={styles.venueGrid}>
            {venues.map((v) => (
              <li key={v.id}>
                <Link href={`/venues/${v.slug}`} className={styles.venueTile}>
                  <div
                    className={styles.art}
                    style={
                      v.image
                        ? { backgroundImage: `url(${v.image})` }
                        : undefined
                    }
                    role="img"
                    aria-label={v.name}
                  />
                  <div className={styles.body}>
                    <strong>{v.name}</strong>
                    <span>
                      {v.city}
                      {v.state ? `, ${v.state}` : ''} · {plural(v.eventCount, 'evento')}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {cities.length > 0 && (
          <section className={styles.section} aria-labelledby="venues-cities">
            <h2 id="venues-cities">Por ciudad</h2>
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

        {categories.length > 0 && (
          <section className={styles.section} aria-labelledby="venues-cats">
            <h2 id="venues-cats">Categorías</h2>
            <ul className={styles.chipRow}>
              {categories.map((c) => (
                <li key={c.key}>
                  <Link
                    href={`/categoria/${c.key.toLowerCase()}`}
                    className={styles.chip}
                  >
                    {categoryLabel(c.key)}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
