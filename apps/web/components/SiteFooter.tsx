import Link from 'next/link';
import { CATEGORY_LABEL } from '@/lib/format';
import styles from './SiteFooter.module.scss';

const CATEGORIES = [
  { key: 'MUSIC', label: CATEGORY_LABEL.MUSIC },
  { key: 'SPORTS', label: CATEGORY_LABEL.SPORTS },
  { key: 'THEATER', label: CATEGORY_LABEL.THEATER },
  { key: 'COMEDY', label: CATEGORY_LABEL.COMEDY },
  { key: 'FESTIVAL', label: CATEGORY_LABEL.FESTIVAL },
  { key: 'FAMILY', label: CATEGORY_LABEL.FAMILY },
] as const;

export type FooterCity = { name: string; count: number };

/**
 * Footer presentacional. El layout inyecta ciudades cacheadas desde el servidor;
 * las páginas cliente pueden renderizarlo sin props (sólo enlace a /ciudades).
 */
export function SiteFooter({ cities = [] }: { cities?: readonly FooterCity[] }) {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.brandCol}>
          <p className={styles.brand}>BOLETERA</p>
          <p className={styles.tagline}>Boletos oficiales · Pagos Banorte · Acceso con QR</p>
        </div>

        <div className={styles.col}>
          <h3>Categorías</h3>
          <ul>
            {CATEGORIES.map((c) => (
              <li key={c.key}>
                <Link href={`/categoria/${c.key}`}>{c.label}</Link>
              </li>
            ))}
          </ul>
        </div>

        <div className={styles.col}>
          <h3>Ciudades</h3>
          <ul>
            <li>
              <Link href="/ciudades">Todas las ciudades</Link>
            </li>
            {cities.map((c) => (
              <li key={c.name}>
                <Link href={`/ciudades/${encodeURIComponent(c.name)}`}>{c.name}</Link>
              </li>
            ))}
          </ul>
        </div>

        <div className={styles.col}>
          <h3>Explorar</h3>
          <ul>
            <li>
              <Link href="/venues">Recintos</Link>
            </li>
            <li>
              <Link href="/resale">Reventa</Link>
            </li>
            <li>
              <Link href="/ayuda">Ayuda</Link>
            </li>
            <li>
              <Link href="/cuenta">Mi cuenta</Link>
            </li>
          </ul>
        </div>

        <div className={styles.col}>
          <h3>Legal</h3>
          <ul>
            <li>
              <Link href="/terminos">Términos</Link>
            </li>
            <li>
              <Link href="/privacidad">Privacidad</Link>
            </li>
          </ul>
        </div>
      </div>
      <p className={styles.copy}>
        © {new Date().getFullYear()} BOLETERA · Liquidación Banorte
      </p>
    </footer>
  );
}
