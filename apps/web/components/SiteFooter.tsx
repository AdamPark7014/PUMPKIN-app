'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import styles from './SiteFooter.module.scss';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

const CATEGORIES = [
  { key: 'MUSIC', label: 'Conciertos' },
  { key: 'SPORTS', label: 'Deportes' },
  { key: 'THEATER', label: 'Artes' },
  { key: 'COMEDY', label: 'Comedia' },
  { key: 'FESTIVAL', label: 'Festivales' },
  { key: 'FAMILY', label: 'Familiares' },
];

export function SiteFooter() {
  const [cities, setCities] = useState<{ name: string; count: number }[]>([]);

  useEffect(() => {
    fetch(`${API}/discovery/facets`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.cities?.length) setCities(data.cities.slice(0, 8));
      })
      .catch(() => {});
  }, []);

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
