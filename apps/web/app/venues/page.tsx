import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { api } from '@/lib/api';
import styles from '../hub.module.scss';

type VenueHit = {
  id: string;
  slug: string;
  name: string;
  city: string;
  state?: string;
  image?: string | null;
  eventCount: number;
};

export default async function VenuesPage() {
  let venues: VenueHit[] = [];
  try {
    venues = await api<VenueHit[]>('/discovery/venues?limit=40');
  } catch {
    venues = [];
  }

  return (
    <>
      <SiteHeader />
      <main className={styles.page}>
        <div className={styles.crumb}>
          <Link href="/">Cartelera</Link>
          <span>/</span>
          <span>Recintos</span>
        </div>
        <header className={styles.hero}>
          <h1>Inmuebles</h1>
          <p>Recintos con cartelera activa.</p>
        </header>
        {venues.length === 0 ? (
          <p className={styles.empty}>
            Sin recintos publicados. <Link href="/">Volver</Link>
          </p>
        ) : (
          <ul className={styles.venueGrid}>
            {venues.map((v) => (
              <li key={v.id}>
                <Link href={`/venues/${v.slug}`} className={styles.venueTile}>
                  <div
                    className={styles.art}
                    style={v.image ? { backgroundImage: `url(${v.image})` } : undefined}
                  />
                  <div className={styles.body}>
                    <strong>{v.name}</strong>
                    <span>
                      {v.city}
                      {v.state ? `, ${v.state}` : ''} · {v.eventCount} evento
                      {v.eventCount === 1 ? '' : 's'}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
