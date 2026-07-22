'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { getStoredUser, getToken } from '@/lib/auth';
import styles from './SiteHeader.module.scss';

type SiteHeaderProps = {
  theme?: 'light' | 'dark';
};

const navItems = [
  { href: '/events', label: 'Eventos' },
  { href: '/resale', label: 'Reventa' },
];

export function SiteHeader({ theme = 'light' }: SiteHeaderProps) {
  const pathname = usePathname();
  const [loggedIn, setLoggedIn] = useState(false);
  const [name, setName] = useState('');
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const user = getStoredUser();
    setLoggedIn(!!getToken());
    setName(user ? `${user.firstName}` : '');
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`${styles.header} ${theme === 'dark' ? styles.dark : ''} ${
        scrolled ? styles.scrolled : ''
      }`}
    >
      <div className={styles.inner}>
        <Link href="/" className={styles.brand} aria-label="Boletera">
          <span className={styles.logo}>
            <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <rect width="32" height="32" rx="9" fill="currentColor" />
              <path
                d="M9 11h14M9 16h14M9 21h9"
                stroke={theme === 'dark' ? '#0a0a0a' : '#fafafa'}
                strokeWidth="2.4"
                strokeLinecap="round"
              />
              <circle cx="22" cy="21" r="2.5" fill={theme === 'dark' ? '#0a0a0a' : '#fafafa'} />
            </svg>
          </span>
          <span className={styles.brandText}>BOLETERA</span>
        </Link>

        <nav className={`${styles.nav} ${open ? styles.navOpen : ''}`}>
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={pathname === item.href ? styles.navActive : styles.navLink}
              onClick={() => setOpen(false)}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className={styles.actions}>
          <Link href="/cart" className={styles.iconLink} aria-label="Carrito">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M6 4h12l2 6-7 10-7-10z M3 10h18"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
          {loggedIn ? (
            <Link href="/cuenta" className={styles.userLink}>
              <span className={styles.avatar}>{(name || 'M').charAt(0).toUpperCase()}</span>
              <span className={styles.userText}>{name || 'Mi cuenta'}</span>
            </Link>
          ) : (
            <Link href="/login" className={styles.cta}>
              Entrar
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M5 12h14m-5-5 5 5-5 5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Link>
          )}
          <button
            type="button"
            className={styles.menuBtn}
            onClick={() => setOpen((v) => !v)}
            aria-label="Abrir menú"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d={open ? 'M6 6l12 12M6 18L18 6' : 'M4 6h16M4 12h16M4 18h16'}
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}
