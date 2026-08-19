'use client';

import Link from 'next/link';
import { Suspense, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { getStoredUser, getToken } from '@/lib/auth';
import styles from './SiteHeader.module.scss';

type SiteHeaderProps = {
  theme?: 'light' | 'dark';
};

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

// Evento único: la navegación son las secciones del evento, no categorías.
const navItems: { href: string; label: string; category?: string }[] = [
  { href: '/#boletos', label: 'Boletos' },
  { href: '/#atracciones', label: 'Atracciones' },
  { href: '/boletos', label: 'Comprar' },
  { href: '/ayuda', label: 'Ayuda' },
];

type SuggestHit = {
  id: string;
  slug: string;
  title: string;
  startsAt: string;
  subtitle?: string;
};

export function SiteHeader(props: SiteHeaderProps) {
  return (
    <Suspense fallback={<SiteHeaderBar {...props} activeCategory={null} />}>
      <SiteHeaderWithParams {...props} />
    </Suspense>
  );
}

function SiteHeaderWithParams(props: SiteHeaderProps) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const fromPath = pathname.startsWith('/categoria/')
    ? pathname.split('/')[2] ?? null
    : null;
  return (
    <SiteHeaderBar
      {...props}
      activeCategory={searchParams.get('category') || fromPath}
    />
  );
}

function SiteHeaderBar({
  theme = 'light',
  activeCategory,
}: SiteHeaderProps & { activeCategory: string | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggedIn, setLoggedIn] = useState(false);
  const [name, setName] = useState('');
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<SuggestHit[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeSuggest, setActiveSuggest] = useState(-1);
  const searchRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!searchRef.current?.contains(e.target as Node)) {
        setSuggestOpen(false);
        setActiveSuggest(-1);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setSuggestOpen(false);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `${API}/discovery/suggest?q=${encodeURIComponent(q)}&limit=6`,
          { cache: 'no-store' },
        );
        if (!res.ok) return;
        const data = (await res.json()) as SuggestHit[];
        setSuggestions(data);
        setSuggestOpen(data.length > 0);
        setActiveSuggest(-1);
      } catch {
        /* ignore */
      }
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  function pickSuggest(hit: SuggestHit) {
    setSuggestOpen(false);
    setQuery('');
    setOpen(false);
    router.push(`/events/${hit.slug}`);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    setSuggestOpen(false);
    setOpen(false);
    if (!q) {
      router.push('/');
      return;
    }
    if (activeSuggest >= 0 && suggestions[activeSuggest]) {
      pickSuggest(suggestions[activeSuggest]);
      return;
    }
    router.push(`/?q=${encodeURIComponent(q)}`);
  }

  function onSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!suggestOpen || !suggestions.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveSuggest((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveSuggest((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Escape') {
      setSuggestOpen(false);
      setActiveSuggest(-1);
    }
  }

  const effectiveTheme = theme === 'dark' && !scrolled ? 'dark' : 'light';

  return (
    <header
      className={`${styles.header} ${effectiveTheme === 'dark' ? styles.dark : ''} ${
        scrolled ? styles.scrolled : ''
      } ${theme === 'dark' && !scrolled ? styles.overHero : ''}`}
    >
      <div className={styles.inner}>
        <Link href="/" className={styles.brand} aria-label="Pumpkin Zone inicio">
          <span className={styles.logo}>
            <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <rect width="32" height="32" rx="9" fill="currentColor" />
              <path
                d="M9 11h14M9 16h14M9 21h9"
                stroke={effectiveTheme === 'dark' ? '#0a0a0a' : '#fafafa'}
                strokeWidth="2.4"
                strokeLinecap="round"
              />
              <circle
                cx="22"
                cy="21"
                r="2.5"
                fill={effectiveTheme === 'dark' ? '#0a0a0a' : '#fafafa'}
              />
            </svg>
          </span>
          <span className={styles.brandText}>PUMPKIN ZONE</span>
        </Link>

        <div className={styles.search} ref={searchRef}>
          <form onSubmit={onSubmit}>
            <label className={styles.searchLabel}>
              <span className={styles.srOnly}>Buscar eventos</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.7" />
                <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
              <input
                type="search"
                placeholder="Buscar eventos"
                value={query}
                autoComplete="off"
                aria-autocomplete="list"
                aria-expanded={suggestOpen}
                onChange={(e) => setQuery(e.target.value)}
                onFocus={() => suggestions.length > 0 && setSuggestOpen(true)}
                onKeyDown={onSearchKeyDown}
              />
            </label>
          </form>
          {suggestOpen && suggestions.length > 0 && (
            <ul className={styles.suggest} role="listbox">
              {suggestions.map((s, i) => (
                <li key={s.id} role="option" aria-selected={i === activeSuggest}>
                  <button
                    type="button"
                    className={i === activeSuggest ? styles.suggestActive : styles.suggestItem}
                    onMouseEnter={() => setActiveSuggest(i)}
                    onClick={() => pickSuggest(s)}
                  >
                    <strong>{s.title}</strong>
                    <span>{s.subtitle}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <nav className={`${styles.nav} ${open ? styles.navOpen : ''}`}>
          {navItems.map((item) => {
            const active = item.category
              ? activeCategory === item.category || pathname === item.href
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? styles.navActive : styles.navLink}
                onClick={() => setOpen(false)}
              >
                {item.label}
              </Link>
            );
          })}
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
              <span className={styles.userText}>{name || 'Cuenta'}</span>
            </Link>
          ) : (
            <Link href="/login" className={styles.cta}>
              Entrar
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
