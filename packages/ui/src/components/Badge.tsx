import type { ReactNode } from 'react';
import styles from './Badge.module.scss';

export function Badge({ children, variant = 'default' }: { children: ReactNode; variant?: 'default' | 'success' | 'warning' }) {
  return <span className={`${styles.badge} ${styles[variant]}`}>{children}</span>;
}
