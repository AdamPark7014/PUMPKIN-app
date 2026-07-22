import type { ReactNode } from 'react';
import styles from './Card.module.scss';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`${styles.card} ${className}`}>{children}</div>;
}
