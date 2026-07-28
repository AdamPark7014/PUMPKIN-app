'use client';

import Link from 'next/link';
import styles from './PosShell.module.scss';

export function PosShell({
  title,
  eyebrow = 'Taquilla',
  online = true,
  backHref = '/',
  children,
  wide = false,
  size,
}: {
  title: string;
  eyebrow?: string;
  online?: boolean;
  backHref?: string;
  children: React.ReactNode;
  wide?: boolean;
  size?: 'sm' | 'md' | 'wide';
}) {
  const width = size ?? (wide ? 'wide' : 'sm');
  const pageClass =
    width === 'wide' ? styles.pageWide : width === 'md' ? styles.pageMd : styles.page;

  return (
    <div className={pageClass}>
      <div className={styles.bg} aria-hidden />
      <header className={styles.header}>
        <Link href={backHref} className={styles.back} aria-label="Volver">
          ←
        </Link>
        <div className={styles.headerCenter}>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h1>{title}</h1>
        </div>
        <span className={online ? styles.netOn : styles.netOff}>
          <span className={styles.dot} />
          {online ? 'Online' : 'Offline'}
        </span>
      </header>
      {children}
    </div>
  );
}
