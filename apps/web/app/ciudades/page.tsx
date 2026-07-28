import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { api } from '@/lib/api';
import styles from '../hub.module.scss';

type CityFacet = { name: string; count: number };

export default async function CiudadesPage() {
  let cities: CityFacet[] = [];
  try {
    const facets = await api<{ cities: CityFacet[] }>('/discovery/facets');
    cities = facets.cities ?? [];
  } catch {
    cities = [];
  }

  return (
    <>
      <SiteHeader />
      <main className={styles.page}>
        <div className={styles.crumb}>
          <Link href="/">Cartelera</Link>
          <span>/</span>
          <span>Ciudades</span>
        </div>
        <header className={styles.hero}>
          <h1>Ciudades</h1>
          <p>Explora eventos por ciudad en México.</p>
        </header>
        {cities.length === 0 ? (
          <p className={styles.empty}>
            Aún no hay ciudades con cartelera. <Link href="/">Volver</Link>
          </p>
        ) : (
          <ul className={styles.cityGrid}>
            {cities.map((c) => (
              <li key={c.name}>
                <Link
                  href={`/ciudades/${encodeURIComponent(c.name)}`}
                  className={styles.cityTile}
                >
                  <strong>{c.name}</strong>
                  <span>
                    {c.count} evento{c.count === 1 ? '' : 's'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
