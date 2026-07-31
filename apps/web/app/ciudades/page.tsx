import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { Breadcrumbs } from '@/components/storefront/Breadcrumbs';
import { JsonLd } from '@/components/storefront/JsonLd';
import { apiCachedSafe, REVALIDATE } from '@/lib/api';
import { categoryLabel, plural } from '@/lib/format';
import { canonical, SITE_NAME, type JsonLdObject } from '@/lib/seo';
import type { DiscoveryFacets } from '@/lib/storefront-types';
import styles from '../hub.module.scss';

const TITLE = 'Eventos por ciudad';
const DESCRIPTION =
  'Explora la cartelera de BOLETERA por ciudad en México. Boletos oficiales con inventario real.';
const PATH = '/ciudades';

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

function citiesListJsonLd(
  cities: readonly { name: string; count: number }[],
): JsonLdObject {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Ciudades con cartelera',
    numberOfItems: cities.length,
    itemListElement: cities.map((city, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: city.name,
      url: canonical(`/ciudades/${encodeURIComponent(city.name)}`),
    })),
  };
}

export default async function CiudadesPage() {
  const facets = await apiCachedSafe<DiscoveryFacets>(
    '/discovery/facets',
    REVALIDATE.facets,
    ['discovery-facets'],
  );
  const cities = facets?.cities ?? [];
  const categories = (facets?.categories ?? []).slice(0, 8);

  const trail = [
    { name: 'Cartelera', path: '/' },
    { name: 'Ciudades' },
  ] as const;

  return (
    <>
      <SiteHeader />
      <main className={styles.page}>
        <Breadcrumbs trail={trail} />
        {cities.length > 0 && <JsonLd data={citiesListJsonLd(cities)} />}

        <header className={styles.hero}>
          <h1>Ciudades</h1>
          <p>
            {cities.length > 0
              ? `${plural(cities.length, 'ciudad')} con cartelera activa en México.`
              : 'Explora eventos por ciudad en México.'}
          </p>
        </header>

        {cities.length === 0 ? (
          <div className={styles.empty}>
            <p>Aún no hay ciudades con cartelera publicada.</p>
            <div className={styles.emptyLinks}>
              <Link href="/">Ver cartelera</Link>
              <Link href="/venues">Ver recintos</Link>
            </div>
          </div>
        ) : (
          <ul className={styles.cityGrid}>
            {cities.map((c) => (
              <li key={c.name}>
                <Link
                  href={`/ciudades/${encodeURIComponent(c.name)}`}
                  className={styles.cityTile}
                >
                  <strong>{c.name}</strong>
                  <span>{plural(c.count, 'evento')}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {categories.length > 0 && (
          <section className={styles.section} aria-labelledby="cities-cats">
            <h2 id="cities-cats">Por categoría</h2>
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
