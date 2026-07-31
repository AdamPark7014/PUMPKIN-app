'use client';

import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { EventPosterArt } from './EventPosterArt';
import styles from './EventDiscoveryPanel.module.scss';

export type EventHit = {
  id: string;
  slug: string;
  title: string;
  startsAt: string;
  minPrice: number | string;
  currency: string;
  category?: string | null;
  genre?: string | null;
  description?: string | null;
  image?: string | null;
  bannerImage?: string | null;
  posterAspect?: string | null;
  venue?: { name: string; city: string };
  organization?: { name: string; slug: string };
  offerCount?: number;
};

type SuggestHit = {
  id: string;
  slug: string;
  title: string;
  startsAt: string;
  category?: string | null;
  subtitle?: string;
  venue?: { name: string; city: string };
};

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';
const INITIAL_VISIBLE = 24;
const WHEN_KEYS = new Set(['ALL', 'WEEK', 'WEEKEND', 'MONTH']);

const dateParts = {
  day: new Intl.DateTimeFormat('es-MX', { day: '2-digit' }),
  month: new Intl.DateTimeFormat('es-MX', { month: 'short' }),
  weekday: new Intl.DateTimeFormat('es-MX', { weekday: 'short' }),
  time: new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit' }),
  full: new Intl.DateTimeFormat('es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }),
};

const CATEGORY_LABEL: Record<string, string> = {
  MUSIC: 'Concierto',
  SPORTS: 'Deportes',
  THEATER: 'Teatro',
  COMEDY: 'Comedia',
  FESTIVAL: 'Festival',
  STANDUP: 'Stand-up',
  FAMILY: 'Familiar',
  CINEMA: 'Cine',
  OTHER: 'Evento',
};

type SortKey = 'date' | 'price';
type WhenKey = 'ALL' | 'WEEK' | 'WEEKEND' | 'MONTH';
type Facet = { name: string; count: number };
type CategoryFacet = { key: string; count: number };

function parseWhen(value: string | null): WhenKey {
  if (value && WHEN_KEYS.has(value)) return value as WhenKey;
  return 'ALL';
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return {
    day: dateParts.day.format(d),
    month: dateParts.month.format(d).replace('.', ''),
    weekday: dateParts.weekday.format(d).replace('.', ''),
    time: dateParts.time.format(d),
    full: dateParts.full.format(d),
  };
}

function fmtPrice(n: number | string) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return 'Consultar';
  return `Desde $${v.toLocaleString('es-MX', { maximumFractionDigits: 0 })}`;
}

function categoryLabel(key: string | null | undefined) {
  if (!key) return 'Evento';
  return CATEGORY_LABEL[key] ?? key;
}

function posterAspect(event: EventHit) {
  if (event.posterAspect && /^\d+(\.\d+)?\s*\/\s*\d+(\.\d+)?$/.test(event.posterAspect)) {
    return event.posterAspect.replace(/\s+/g, ' ');
  }
  if (event.category === 'FESTIVAL') return '16 / 9';
  if (event.category === 'SPORTS') return '1 / 1';
  if (event.category === 'THEATER') return '2 / 3';
  if (event.category === 'COMEDY') return '4 / 5';
  return '3 / 4';
}

function ResultsSkeleton() {
  return (
    <ul className={styles.resultsSkeleton} aria-label="Cargando eventos" aria-busy="true">
      {Array.from({ length: 8 }, (_, index) => (
        <li key={index} className={styles.skeletonCard}>
          <span className={styles.skeletonArt} />
          <span className={styles.skeletonLine} />
          <span className={styles.skeletonLineShort} />
        </li>
      ))}
    </ul>
  );
}

const LazyPoster = memo(function LazyPoster({
  event,
  size,
  showDate = false,
  eager = false,
}: {
  event: EventHit;
  size: 'md' | 'lg';
  showDate?: boolean;
  eager?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(eager);

  useEffect(() => {
    if (eager || visible) return;
    const node = rootRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setVisible(true);
        observer.disconnect();
      },
      { rootMargin: '480px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [eager, visible]);

  return (
    <div
      ref={rootRef}
      className={size === 'md' ? styles.lazyPosterMd : styles.lazyPosterLg}
      style={{ aspectRatio: posterAspect(event) } as CSSProperties}
      aria-hidden
    >
      {visible ? <EventPosterArt event={event} size={size} showDate={showDate} /> : null}
    </div>
  );
});

const PosterCard = memo(function PosterCard({
  event,
  index,
}: {
  event: EventHit;
  index: number;
}) {
  const d = fmtDate(event.startsAt);
  return (
    <li
      className={styles.posterItem}
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
    >
      <Link href={`/events/${event.slug}`} className={styles.posterCard} prefetch={index < 4}>
        <div className={styles.posterArt}>
          <LazyPoster event={event} size="lg" showDate eager={index < 4} />
        </div>
        <div className={styles.posterBody}>
          <p className={styles.rowCat}>{categoryLabel(event.category)}</p>
          <h3>{event.title}</h3>
          <p>
            {d.weekday} {d.day} {d.month} · {d.time}
            {event.venue?.city ? ` · ${event.venue.city}` : ''}
          </p>
          <span className={styles.posterPrice}>{fmtPrice(event.minPrice)}</span>
        </div>
      </Link>
    </li>
  );
});

const ListCard = memo(function ListCard({
  event,
  index,
}: {
  event: EventHit;
  index: number;
}) {
  const d = fmtDate(event.startsAt);
  return (
    <li>
      <Link href={`/events/${event.slug}`} className={styles.row} prefetch={index < 6}>
        <LazyPoster event={event} size="md" eager={index < 6} />
        <time dateTime={event.startsAt} className={styles.rowDate}>
          <span className={styles.rowWeekday}>{d.weekday}</span>
          <strong>{d.day}</strong>
          <span className={styles.rowMonth}>{d.month}</span>
        </time>
        <div className={styles.rowMain}>
          <p className={styles.rowCat}>{categoryLabel(event.category)}</p>
          <h3>{event.title}</h3>
          <p>
            {event.venue?.name}
            {event.venue?.city ? ` · ${event.venue.city}` : ''}
            <span className={styles.rowDot}>·</span>
            {d.time}
          </p>
        </div>
        <div className={styles.rowSide}>
          <span className={styles.rowPrice}>{fmtPrice(event.minPrice)}</span>
          <span className={styles.rowCta}>Boletos</span>
        </div>
      </Link>
    </li>
  );
});

function StatusPanel({
  title,
  children,
  action,
  tone = 'empty',
  compact = false,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  tone?: 'empty' | 'error';
  compact?: boolean;
}) {
  const className =
    tone === 'error'
      ? compact
        ? styles.errorBanner
        : styles.error
      : styles.empty;
  return (
    <div className={className} role={tone === 'error' ? 'alert' : undefined}>
      <div className={styles.statusCopy}>
        <p className={styles.emptyTitle}>{title}</p>
        <p>{children}</p>
      </div>
      {action}
    </div>
  );
}

export function EventDiscoveryPanel({
  initial,
  compact,
  initialError = false,
  availableCities = [],
  availableCategories = [],
}: {
  initial: EventHit[];
  compact?: boolean;
  initialError?: boolean;
  availableCities?: Facet[];
  availableCategories?: CategoryFacet[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('q') ?? '';
  const [query, setQuery] = useState(initialQuery);
  const deferredQuery = useDeferredValue(query);
  const [appliedQuery, setAppliedQuery] = useState(initialQuery);
  const [city, setCity] = useState(searchParams.get('city') ?? 'ALL');
  const [category, setCategory] = useState(searchParams.get('category') ?? 'ALL');
  const [when, setWhen] = useState<WhenKey>(parseWhen(searchParams.get('when')));
  const [sort, setSort] = useState<SortKey>('date');
  const [events, setEvents] = useState<EventHit[]>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialError);
  const [requestVersion, setRequestVersion] = useState(0);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
  const [suggestions, setSuggestions] = useState<SuggestHit[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeSuggest, setActiveSuggest] = useState(-1);
  const searchWrapRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setCategory(searchParams.get('category') ?? 'ALL');
    setCity(searchParams.get('city') ?? 'ALL');
    const q = searchParams.get('q');
    if (q != null) {
      setQuery(q);
      setAppliedQuery(q);
    } else {
      setQuery('');
      setAppliedQuery('');
    }
    setWhen(parseWhen(searchParams.get('when')));
  }, [searchParams]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!searchWrapRef.current?.contains(e.target as Node)) {
        setSuggestOpen(false);
        setActiveSuggest(-1);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => {
    const q = deferredQuery.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setSuggestOpen(false);
      return;
    }
    const controller = new AbortController();
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `${API}/discovery/suggest?q=${encodeURIComponent(q)}&limit=8`,
          { cache: 'no-store', signal: controller.signal },
        );
        if (!res.ok) return;
        const data = (await res.json()) as SuggestHit[];
        setSuggestions(data);
        setSuggestOpen(data.length > 0);
        setActiveSuggest(-1);
      } catch (requestError) {
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return;
      }
    }, 220);
    return () => {
      window.clearTimeout(t);
      controller.abort();
    };
  }, [deferredQuery]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (appliedQuery.trim()) params.set('q', appliedQuery.trim());
    if (city !== 'ALL') params.set('city', city);
    if (category !== 'ALL') params.set('category', category);
    if (when !== 'ALL') params.set('when', when);
    params.set('limit', '60');

    const isDefault =
      !appliedQuery.trim() && city === 'ALL' && category === 'ALL' && when === 'ALL';
    if (isDefault && requestVersion === 0) {
      setEvents(initial);
      setError(initialError);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const t = window.setTimeout(async () => {
      setLoading(true);
      setError(false);
      try {
        const res = await fetch(`${API}/discovery/events?${params}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Discovery request failed: ${res.status}`);
        setEvents((await res.json()) as EventHit[]);
      } catch (requestError) {
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return;
        setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 280);
    return () => {
      window.clearTimeout(t);
      controller.abort();
    };
  }, [appliedQuery, city, category, when, initial, initialError, requestVersion]);

  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE);
  }, [appliedQuery, city, category, when, sort, events]);

  const cityStats = useMemo(() => {
    if (availableCities.length > 0) return availableCities;
    const map = new Map<string, number>();
    for (const e of initial) {
      const c = e.venue?.city;
      if (!c) continue;
      map.set(c, (map.get(c) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [availableCities, initial]);

  const categoryStats = useMemo(() => {
    if (availableCategories.length > 0) {
      return availableCategories.filter((facet) => facet.key !== 'ALL' && facet.count > 0);
    }
    const map = new Map<string, number>();
    for (const event of initial) {
      if (!event.category) continue;
      map.set(event.category, (map.get(event.category) ?? 0) + 1);
    }
    return Array.from(map, ([key, count]) => ({ key, count })).sort(
      (a, b) => b.count - a.count,
    );
  }, [availableCategories, initial]);

  const totalCatalogCount = useMemo(() => {
    if (availableCities.length > 0) {
      return availableCities.reduce((sum, item) => sum + item.count, 0);
    }
    return initial.length;
  }, [availableCities, initial.length]);

  const filtered = useMemo(() => {
    const next = [...events];
    next.sort((a, b) => {
      if (sort === 'price') return Number(a.minPrice) - Number(b.minPrice);
      return new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
    });
    return next;
  }, [events, sort]);

  const isFiltering =
    Boolean(appliedQuery.trim()) || city !== 'ALL' || category !== 'ALL' || when !== 'ALL';
  const showHero = !compact && !isFiltering && !loading && filtered.length > 0;
  const featured = showHero ? filtered[0] ?? null : null;
  const list = featured ? filtered.slice(1) : filtered;
  const visible = list.slice(0, visibleCount);
  const canShowMore = list.length > visibleCount;
  const showInitialSkeleton = loading && filtered.length === 0 && !error;
  const showSoftLoading = loading && filtered.length > 0;

  const recommendations = useMemo(() => {
    if (isFiltering || compact || filtered.length < 3) return [];
    const featuredId = featured?.id;
    const pool = filtered.filter((event) => event.id !== featuredId);
    const byCategory = new Map<string, EventHit>();
    for (const event of pool) {
      const key = event.category || 'OTHER';
      if (!byCategory.has(key)) byCategory.set(key, event);
      if (byCategory.size >= 4) break;
    }
    const picks = Array.from(byCategory.values());
    if (picks.length >= 3) return picks.slice(0, 4);
    return pool.slice(0, 4);
  }, [compact, featured?.id, filtered, isFiltering]);

  const pushParams = useCallback(
    (next: { q?: string; city?: string; category?: string; when?: string }) => {
      const params = new URLSearchParams(searchParams.toString());
      const apply = (key: string, value: string | undefined, empty = 'ALL') => {
        if (value == null) return;
        if (!value || value === empty) params.delete(key);
        else params.set(key, value);
      };
      apply('q', next.q, '');
      apply('city', next.city);
      apply('category', next.category);
      apply('when', next.when);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const applyFilters = useCallback(
    (next: {
      q?: string;
      city?: string;
      category?: string;
      when?: WhenKey;
    }) => {
      const nextQuery = next.q ?? query.trim();
      const nextCity = next.city ?? city;
      const nextCategory = next.category ?? category;
      const nextWhen = next.when ?? when;
      setAppliedQuery(nextQuery);
      setCity(nextCity);
      setCategory(nextCategory);
      setWhen(nextWhen);
      pushParams({
        q: nextQuery,
        city: nextCity,
        category: nextCategory,
        when: nextWhen,
      });
    },
    [category, city, pushParams, query, when],
  );

  const clearFilters = useCallback(() => {
    setQuery('');
    setAppliedQuery('');
    setCity('ALL');
    setCategory('ALL');
    setWhen('ALL');
    setEvents(initial);
    setError(initialError);
    setSuggestions([]);
    setSuggestOpen(false);
    setRequestVersion(0);
    router.replace(pathname, { scroll: false });
  }, [initial, initialError, pathname, router]);

  const pickSuggest = useCallback(
    (hit: SuggestHit) => {
      setSuggestOpen(false);
      setQuery(hit.title);
      router.push(`/events/${hit.slug}`);
    },
    [router],
  );

  const onSearchKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
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
      } else if (e.key === 'Enter' && activeSuggest >= 0) {
        e.preventDefault();
        const hit = suggestions[activeSuggest];
        if (hit) pickSuggest(hit);
      }
    },
    [activeSuggest, pickSuggest, suggestOpen, suggestions],
  );

  const retry = useCallback(() => {
    setRequestVersion((version) => version + 1);
  }, []);

  const featuredDate = featured ? fmtDate(featured.startsAt) : null;

  return (
    <div className={compact ? styles.compact : styles.wrap}>
      {featured && featuredDate && (
        <Link href={`/events/${featured.slug}`} className={styles.hero}>
          <div className={styles.heroMedia}>
            <EventPosterArt event={featured} size="hero" />
          </div>
          <div className={styles.heroShade} aria-hidden />
          <div className={styles.heroCopy}>
            <p className={styles.brandMark}>BOLETERA</p>
            <p className={styles.heroEyebrow}>{categoryLabel(featured.category)}</p>
            <h1>{featured.title}</h1>
            <p className={styles.heroSupport}>
              {featuredDate.full} · {featuredDate.time}
              {featured.venue?.name ? ` · ${featured.venue.name}` : ''}
              {featured.venue?.city ? `, ${featured.venue.city}` : ''}
            </p>
            <div className={styles.heroCta}>
              <span className={styles.cta}>Comprar boletos</span>
              <span className={styles.heroPrice}>{fmtPrice(featured.minPrice)}</span>
            </div>
          </div>
        </Link>
      )}

      <div className={styles.shell}>
        {!featured && !compact && (
          <header className={styles.intro}>
            <p className={styles.brandMarkDark}>BOLETERA</p>
            <h1 className={styles.introTitle}>Descubre eventos</h1>
            <p className={styles.introLead}>
              Cartelera en vivo con búsqueda, ciudades y categorías según inventario disponible.
            </p>
          </header>
        )}

        <form
          className={styles.searchBar}
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            setSuggestOpen(false);
            applyFilters({ q: query.trim() });
            resultsRef.current?.focus({ preventScroll: false });
          }}
        >
          <div className={styles.searchField} ref={searchWrapRef}>
            <label className={styles.fieldGrow}>
              <span className={styles.srOnly}>Buscar eventos</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.7" />
                <path
                  d="m20 20-3.5-3.5"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                />
              </svg>
              <input
                type="search"
                placeholder="Buscar eventos, venues o ciudades"
                value={query}
                autoComplete="off"
                enterKeyHint="search"
                aria-autocomplete="list"
                aria-expanded={suggestOpen}
                aria-controls="discovery-suggest"
                aria-haspopup="listbox"
                aria-activedescendant={
                  activeSuggest >= 0
                    ? `discovery-suggest-${suggestions[activeSuggest]?.id}`
                    : undefined
                }
                onChange={(e) => setQuery(e.target.value)}
                onFocus={() => suggestions.length > 0 && setSuggestOpen(true)}
                onKeyDown={onSearchKeyDown}
              />
            </label>
            {suggestOpen && suggestions.length > 0 && (
              <ul id="discovery-suggest" className={styles.suggest} role="listbox">
                {suggestions.map((s, i) => {
                  const d = fmtDate(s.startsAt);
                  return (
                    <li
                      id={`discovery-suggest-${s.id}`}
                      key={s.id}
                      role="option"
                      aria-selected={i === activeSuggest}
                    >
                      <button
                        type="button"
                        className={
                          i === activeSuggest ? styles.suggestActive : styles.suggestItem
                        }
                        onMouseEnter={() => setActiveSuggest(i)}
                        onClick={() => pickSuggest(s)}
                      >
                        <strong>{s.title}</strong>
                        <span>
                          {d.full} · {d.time}
                          {s.subtitle ? ` · ${s.subtitle}` : ''}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <select
            className={styles.select}
            value={when}
            aria-label="Fecha"
            onChange={(e) => applyFilters({ when: parseWhen(e.target.value) })}
          >
            <option value="ALL">Cualquier fecha</option>
            <option value="WEEK">Esta semana</option>
            <option value="WEEKEND">Fin de semana</option>
            <option value="MONTH">Próximos 30 días</option>
          </select>
          <button type="submit" className={styles.searchSubmit}>
            Buscar
          </button>
        </form>

        {cityStats.length > 0 && (
          <div className={styles.cityHubs} role="group" aria-label="Explorar por ciudad">
            <button
              type="button"
              className={city === 'ALL' ? styles.hubActive : styles.hub}
              aria-pressed={city === 'ALL'}
              onClick={() => applyFilters({ city: 'ALL' })}
            >
              Todo México
              <em>{totalCatalogCount}</em>
            </button>
            {cityStats.map((c) => (
              <button
                key={c.name}
                type="button"
                className={city === c.name ? styles.hubActive : styles.hub}
                aria-pressed={city === c.name}
                onClick={() => applyFilters({ city: c.name })}
              >
                {c.name}
                <em>{c.count}</em>
              </button>
            ))}
          </div>
        )}

        {(categoryStats.length > 0 || initial.length > 0) && (
          <div className={styles.catHubs} role="group" aria-label="Explorar por categoría">
            {[
              { key: 'ALL', count: totalCatalogCount },
              ...categoryStats,
            ].map((c) => (
              <button
                key={c.key}
                type="button"
                className={
                  (c.key === 'ALL' ? category === 'ALL' : category === c.key)
                    ? styles.catActive
                    : styles.cat
                }
                aria-pressed={c.key === 'ALL' ? category === 'ALL' : category === c.key}
                onClick={() => applyFilters({ category: c.key })}
              >
                {c.key === 'ALL' ? 'Todos' : categoryLabel(c.key)}
                <span className={styles.catCount}>{c.count}</span>
              </button>
            ))}
          </div>
        )}

        {!isFiltering && recommendations.length > 0 && (
          <section className={styles.reco} aria-label="Recomendaciones">
            <div className={styles.recoHead}>
              <h2>Para empezar</h2>
              <p>Selección a partir de la cartelera disponible</p>
            </div>
            <ul className={styles.recoGrid}>
              {recommendations.map((event, index) => {
                const d = fmtDate(event.startsAt);
                return (
                  <li key={event.id}>
                    <Link
                      href={`/events/${event.slug}`}
                      className={styles.recoCard}
                      prefetch={index < 2}
                    >
                      <div className={styles.recoArt}>
                        <LazyPoster event={event} size="md" eager={index < 2} />
                      </div>
                      <div className={styles.recoBody}>
                        <p className={styles.rowCat}>{categoryLabel(event.category)}</p>
                        <strong>{event.title}</strong>
                        <span>
                          {d.weekday} {d.day} {d.month}
                          {event.venue?.city ? ` · ${event.venue.city}` : ''}
                        </span>
                        <em>{fmtPrice(event.minPrice)}</em>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section
          ref={resultsRef}
          className={styles.listSection}
          aria-label="Eventos"
          aria-busy={loading}
          tabIndex={-1}
        >
          {showSoftLoading && <div className={styles.loadingBar} aria-hidden />}
          <div className={styles.listHead}>
            <div>
              <h2 className={styles.listTitle}>
                {isFiltering ? 'Resultados' : 'Próximos eventos'}
              </h2>
              <p className={styles.listCount} aria-live="polite">
                {loading
                  ? 'Buscando…'
                  : `${filtered.length} evento${filtered.length === 1 ? '' : 's'}`}
                {!loading && city !== 'ALL' ? ` en ${city}` : ''}
                {!loading && category !== 'ALL' ? ` · ${categoryLabel(category)}` : ''}
              </p>
            </div>
            <div className={styles.listTools}>
              {isFiltering && (
                <button type="button" className={styles.clear} onClick={clearFilters}>
                  Limpiar
                </button>
              )}
              <label className={styles.sort}>
                <span className={styles.srOnly}>Ordenar</span>
                <select
                  value={sort}
                  onChange={(e) =>
                    setSort(e.target.value === 'price' ? 'price' : 'date')
                  }
                >
                  <option value="date">Por fecha</option>
                  <option value="price">Por precio</option>
                </select>
              </label>
            </div>
          </div>

          <div className={styles.resultsAnchor}>
            {error && (
              <StatusPanel
                tone="error"
                compact={filtered.length > 0}
                title="No pudimos actualizar la cartelera"
                action={
                  <button type="button" className={styles.clear} onClick={retry}>
                    Reintentar
                  </button>
                }
              >
                {filtered.length > 0
                  ? 'Mostramos los eventos disponibles mientras vuelves a intentar.'
                  : 'Revisa tu conexión e inténtalo de nuevo.'}
              </StatusPanel>
            )}

            {showInitialSkeleton ? (
              <ResultsSkeleton />
            ) : filtered.length === 0 && !error ? (
              <StatusPanel
                title="Sin resultados"
                action={
                  <button type="button" className={styles.clear} onClick={clearFilters}>
                    Ver toda la cartelera
                  </button>
                }
              >
                Prueba otra ciudad o limpia los filtros para ver la cartelera disponible.
              </StatusPanel>
            ) : filtered.length > 0 && !isFiltering && !compact ? (
              <>
                <ul className={styles.posterGrid}>
                  {visible.map((e, idx) => (
                    <PosterCard key={e.id} event={e} index={idx} />
                  ))}
                </ul>
                {canShowMore && (
                  <button
                    type="button"
                    className={styles.more}
                    onClick={() => setVisibleCount((count) => count + INITIAL_VISIBLE)}
                  >
                    Ver más eventos
                  </button>
                )}
              </>
            ) : filtered.length > 0 ? (
              <>
                <ul className={styles.list}>
                  {visible.map((e, idx) => (
                    <ListCard key={e.id} event={e} index={idx} />
                  ))}
                </ul>
                {canShowMore && (
                  <button
                    type="button"
                    className={styles.more}
                    onClick={() => setVisibleCount((count) => count + INITIAL_VISIBLE)}
                  >
                    Ver más eventos
                  </button>
                )}
              </>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
