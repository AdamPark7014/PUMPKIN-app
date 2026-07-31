'use client';

import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Resolves the effective reduced-motion preference.
 *
 * @param preference `'auto'` (default) subscribes to the OS media query; a
 * boolean forces the value, which is what hosts that already resolved the
 * preference (e.g. `useReducedMotion()` from the design system) should pass.
 */
export function usePrefersReducedMotion(preference: boolean | 'auto' = 'auto'): boolean {
  const [system, setSystem] = useState(false);

  useEffect(() => {
    if (preference !== 'auto') return;
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(QUERY);
    setSystem(query.matches);
    const onChange = (event: MediaQueryListEvent) => setSystem(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [preference]);

  return preference === 'auto' ? system : preference;
}
