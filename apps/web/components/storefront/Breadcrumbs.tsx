import Link from 'next/link';
import { breadcrumbJsonLd } from '@/lib/seo';
import { JsonLd } from './JsonLd';
import styles from './Breadcrumbs.module.scss';

export type Crumb = {
  name: string;
  /** Ruta relativa; el último nivel se omite porque es la página actual. */
  path?: string;
};

/**
 * Migas de pan visibles + `BreadcrumbList` para Google, desde una sola fuente
 * de verdad. Server Component: cero JavaScript en el cliente.
 */
export function Breadcrumbs({
  trail,
  tone = 'light',
}: {
  trail: readonly Crumb[];
  tone?: 'light' | 'dark';
}) {
  if (trail.length === 0) return null;

  return (
    <>
      <JsonLd data={breadcrumbJsonLd(trail)} />
      <nav
        className={`${styles.crumbs} ${tone === 'dark' ? styles.dark : ''}`}
        aria-label="Ruta de navegación"
      >
        <ol>
          {trail.map((crumb, i) => {
            const last = i === trail.length - 1;
            return (
              <li key={`${crumb.name}-${i}`}>
                {crumb.path && !last ? (
                  <Link href={crumb.path}>{crumb.name}</Link>
                ) : (
                  <span aria-current={last ? 'page' : undefined}>{crumb.name}</span>
                )}
                {!last && (
                  <span className={styles.sep} aria-hidden="true">
                    /
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
    </>
  );
}
