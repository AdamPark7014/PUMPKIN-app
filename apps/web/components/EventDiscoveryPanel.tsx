'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
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

function fmtDate(iso: string) {
  const d = new Date(iso);
  return {
    day: d.toLocaleDateString('es-MX', { day: '2-digit' }),
    month: d.toLocaleDateString('es-MX', { month: 'short' }).replace('.', ''),
    weekday: d.toLocaleDateString('es-MX', { weekday: 'short' }).replace('.', ''),
    time: d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
    full: d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' }),
  };
}

function fmtPrice(n: number | string) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return 'Consultar';
  return `Desde $${v.toLocaleString('es-MX', { maximumFractionDigits: 0 })}`;
}

export function EventDiscoveryPanel({
  initial,
  compact,
}: {
  initial: EventHit[];
  compact?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') ?? '');
  const [city, setCity] = useState(searchParams.get('city') ?? 'ALL');
  const [category, setCategory] = useState(searchParams.get('category') ?? 'ALL');
  const [when, setWhen] = useState<WhenKey>((searchParams.get('when') as WhenKey) || 'ALL');
  const [sort, setSort] = useState<SortKey>('date');
  const [events, setEvents] = useState<EventHit[]>(initial);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestHit[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeSuggest, setActiveSuggest] = useState(-1);
  const searchWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCategory(searchParams.get('category') ?? 'ALL');
    setCity(searchParams.get('city') ?? 'ALL');
    const q = searchParams.get('q');
    if (q != null) setQuery(q);
    const w = searchParams.get('when') as WhenKey | null;
    if (w) setWhen(w);
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
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setSuggestOpen(false);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `${API}/discovery/suggest?q=${encodeURIComponent(q)}&limit=8`,
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
    }, 220);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (city !== 'ALL') params.set('city', city);
    if (category !== 'ALL') params.set('category', category);
    if (when !== 'ALL') params.set('when', when);
    params.set('limit', '60');

    const isDefault =
      !query.trim() && city === 'ALL' && category === 'ALL' && when === 'ALL';
    if (isDefault) {
      setEvents(initial);
      return;
    }

    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API}/discovery/events?${params}`, { cache: 'no-store' });
        if (res.ok) setEvents(await res.json());
      } catch {
        /* keep previous */
      } finally {
        setLoading(false);
      }
    }, 280);
    return () => clearTimeout(t);
  }, [query, city, category, when, initial]);

  const cityStats = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of initial) {
      const c = e.venue?.city;
      if (!c) continue;
      map.set(c, (map.get(c) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [initial]);

  const filtered = useMemo(() => {
    return [...events].sort((a, b) => {
      if (sort === 'price') return Number(a.minPrice) - Number(b.minPrice);
      return new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
    });
  }, [events, sort]);

  const isFiltering = Boolean(query.trim()) || city !== 'ALL' || category !== 'ALL' || when !== 'ALL';
  const featured = !compact && !isFiltering ? filtered[0] : null;
  const list = featured ? filtered.slice(1) : filtered;

  function pushParams(next: { q?: string; city?: string; category?: string; when?: string }) {
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
  }

  function clearFilters() {
    setQuery('');
    setCity('ALL');
    setCategory('ALL');
    setWhen('ALL');
    setEvents(initial);
    setSuggestions([]);
    setSuggestOpen(false);
    router.replace(pathname, { scroll: false });
  }

  function pickSuggest(hit: SuggestHit) {
    setSuggestOpen(false);
    setQuery(hit.title);
    router.push(`/events/${hit.slug}`);
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
    } else if (e.key === 'Enter' && activeSuggest >= 0) {
      e.preventDefault();
      pickSuggest(suggestions[activeSuggest]);
    }
  }

  return (
    <div className={compact ? styles.compact : styles.wrap}>
      {featured && (
        <Link href={`/events/${featured.slug}`} className={styles.hero}>
          <div className={styles.heroMedia}>
            <EventPosterArt event={featured} size="hero" />
          </div>
          <div className={styles.heroShade} aria-hidden />
          <div className={styles.heroCopy}>
            <p className={styles.brandMark}>BOLETERA</p>
            <h2>{featured.title}</h2>
            <p className={styles.heroSupport}>
              {fmtDate(featured.startsAt).full} · {fmtDate(featured.startsAt).time}
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
        {!featured && (
          <div className={styles.trust}>
            <span>Boletos oficiales</span>
            <span aria-hidden>·</span>
            <span>Inventario en tiempo real</span>
            <span aria-hidden>·</span>
            <span>Pagos Banorte</span>
          </div>
        )}

        <form
          className={styles.searchBar}
          onSubmit={(e) => {
            e.preventDefault();
            setSuggestOpen(false);
            pushParams({ q: query, city, category, when });
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
                aria-autocomplete="list"
                aria-expanded={suggestOpen}
                aria-controls="discovery-suggest"
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
                    <li key={s.id} role="option" aria-selected={i === activeSuggest}>
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
            onChange={(e) => {
              const v = e.target.value as WhenKey;
              setWhen(v);
              pushParams({ q: query, city, category, when: v });
            }}
          >
            <option value="ALL">Cualquier fecha</option>
            <option value="WEEK">Esta semana</option>
            <option value="WEEKEND">Fin de semana</option>
            <option value="MONTH">Próximos 30 días</option>
          </select>
        </form>

        {cityStats.length > 0 && (
          <div className={styles.cityHubs} role="toolbar" aria-label="Ciudades">
            <button
              type="button"
              className={city === 'ALL' ? styles.hubActive : styles.hub}
              onClick={() => {
                setCity('ALL');
                pushParams({ q: query, city: 'ALL', category, when });
              }}
            >
              Todo México
              <em>{initial.length}</em>
            </button>
            {cityStats.map((c) => (
              <button
                key={c.name}
                type="button"
                className={city === c.name ? styles.hubActive : styles.hub}
                onClick={() => {
                  setCity(c.name);
                  pushParams({ q: query, city: c.name, category, when });
                }}
              >
                {c.name}
                <em>{c.count}</em>
              </button>
            ))}
          </div>
        )}

        <div className={styles.catHubs} role="toolbar" aria-label="Categorías">
          {[
            { key: 'ALL', label: 'Todos' },
            { key: 'MUSIC', label: 'Conciertos' },
            { key: 'SPORTS', label: 'Deportes' },
            { key: 'THEATER', label: 'Artes' },
            { key: 'COMEDY', label: 'Comedia' },
            { key: 'FESTIVAL', label: 'Festivales' },
          ].map((c) => (
            <button
              key={c.key}
              type="button"
              className={
                (c.key === 'ALL' ? category === 'ALL' : category === c.key)
                  ? styles.catActive
                  : styles.cat
              }
              onClick={() => {
                setCategory(c.key);
                pushParams({ q: query, city, category: c.key, when });
              }}
            >
              {c.label}
            </button>
          ))}
        </div>

        <section className={styles.listSection} aria-label="Eventos">
          <div className={styles.listHead}>
            <div>
              <h2 className={styles.listTitle}>
                {isFiltering ? 'Resultados' : 'Próximos eventos'}
              </h2>
              <p className={styles.listCount}>
                {loading
                  ? 'Buscando…'
                  : `${filtered.length} evento${filtered.length === 1 ? '' : 's'}`}
                {!loading && city !== 'ALL' ? ` en ${city}` : ''}
                {!loading && category !== 'ALL'
                  ? ` · ${CATEGORY_LABEL[category] ?? category}`
                  : ''}
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
                <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                  <option value="date">Por fecha</option>
                  <option value="price">Por precio</option>
                </select>
              </label>
            </div>
          </div>

          {!isFiltering && !compact ? (
            <ul className={styles.posterGrid} aria-busy={loading}>
              {list.map((e, idx) => {
                const d = fmtDate(e.startsAt);
                return (
                  <li
                    key={e.id}
                    style={{ animationDelay: `${Math.min(idx, 8) * 40}ms` }}
                    className={styles.posterItem}
                  >
                    <Link href={`/events/${e.slug}`} className={styles.posterCard}>
                      <div className={styles.posterArt}>
                        <EventPosterArt event={e} size="lg" showDate />
                      </div>
                      <div className={styles.posterBody}>
                        <p className={styles.rowCat}>
                          {CATEGORY_LABEL[e.category || ''] ?? 'Evento'}
                        </p>
                        <h3>{e.title}</h3>
                        <p>
                          {d.weekday} {d.day} {d.month} · {d.time}
                          {e.venue?.city ? ` · ${e.venue.city}` : ''}
                        </p>
                        <span className={styles.posterPrice}>{fmtPrice(e.minPrice)}</span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <ul className={styles.list} aria-busy={loading}>
              {list.map((e) => {
                const d = fmtDate(e.startsAt);
                return (
                  <li key={e.id}>
                    <Link href={`/events/${e.slug}`} className={styles.row}>
                      <EventPosterArt event={e} size="md" />
                      <time dateTime={e.startsAt} className={styles.rowDate}>
                        <span className={styles.rowWeekday}>{d.weekday}</span>
                        <strong>{d.day}</strong>
                        <span className={styles.rowMonth}>{d.month}</span>
                      </time>
                      <div className={styles.rowMain}>
                        <p className={styles.rowCat}>
                          {CATEGORY_LABEL[e.category || ''] ?? 'Evento'}
                        </p>
                        <h3>{e.title}</h3>
                        <p>
                          {e.venue?.name}
                          {e.venue?.city ? ` · ${e.venue.city}` : ''}
                          <span className={styles.rowDot}>·</span>
                          {d.time}
                        </p>
                      </div>
                      <div className={styles.rowSide}>
                        <span className={styles.rowPrice}>{fmtPrice(e.minPrice)}</span>
                        <span className={styles.rowCta}>Boletos</span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          {filtered.length === 0 && !loading && (
            <div className={styles.empty}>
              <p className={styles.emptyTitle}>Sin resultados</p>
              <p>Prueba otra ciudad o limpia los filtros para ver toda la cartelera.</p>
              <button type="button" className={styles.clear} onClick={clearFilters}>
                Ver toda la cartelera
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
