'use client';

import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Slide } from '@/lib/event-config';
import styles from './EventCarousel.module.scss';

type Props = { slides: Slide[]; autoplayMs?: number };

export function EventCarousel({ slides, autoplayMs = 5500 }: Props) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const count = slides.length;

  const go = useCallback(
    (next: number) => setIndex(((next % count) + count) % count),
    [count],
  );

  useEffect(() => {
    if (paused || count < 2) return;
    // Respeta a quien pidió menos movimiento: sin autoplay.
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;

    const id = window.setInterval(() => setIndex((i) => (i + 1) % count), autoplayMs);
    return () => window.clearInterval(id);
  }, [paused, count, autoplayMs]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(index + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(index - 1); }
  };

  return (
    <div
      className={styles.carousel}
      role="region"
      aria-roledescription="carrusel"
      aria-label="Galería del evento"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onTouchStart={(e) => { touchStartX.current = e.touches[0]?.clientX ?? null; }}
      onTouchEnd={(e) => {
        const start = touchStartX.current;
        const end = e.changedTouches[0]?.clientX;
        if (start == null || end == null) return;
        const delta = end - start;
        if (Math.abs(delta) > 44) go(index + (delta < 0 ? 1 : -1));
        touchStartX.current = null;
      }}
    >
      <div className={styles.viewport}>
        {slides.map((slide, i) => (
          <figure
            key={slide.id}
            className={`${styles.slide} ${i === index ? styles.active : ''}`}
            aria-hidden={i !== index}
            // Fuera del orden de tabulación mientras no se ve.
            inert={i !== index || undefined}
          >
            {slide.src?.endsWith('.svg') ? (
              // Ilustraciones SVG servidas tal cual: next/image las bloquea
              // por defecto y no hay nada que optimizar en un vector.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={slide.src}
                alt={slide.title}
                className={styles.photo}
                loading={i === 0 ? 'eager' : 'lazy'}
              />
            ) : slide.src ? (
              <Image
                src={slide.src}
                alt={slide.title}
                fill
                sizes="(max-width: 900px) 100vw, 900px"
                className={styles.photo}
                priority={i === 0}
              />
            ) : (
              <GeneratedScene scene={slide.scene} />
            )}

            <figcaption className={styles.caption}>
              <span className={styles.slideTitle}>{slide.title}</span>
              <span className={styles.slideText}>{slide.caption}</span>
            </figcaption>
          </figure>
        ))}
      </div>

      <button
        type="button"
        className={`${styles.arrow} ${styles.prev}`}
        onClick={() => go(index - 1)}
        aria-label="Imagen anterior"
      >
        <Chevron dir="left" />
      </button>
      <button
        type="button"
        className={`${styles.arrow} ${styles.next}`}
        onClick={() => go(index + 1)}
        aria-label="Imagen siguiente"
      >
        <Chevron dir="right" />
      </button>

      <div className={styles.dots} role="tablist" aria-label="Elegir imagen">
        {slides.map((slide, i) => (
          <button
            key={slide.id}
            type="button"
            role="tab"
            aria-selected={i === index}
            aria-label={slide.title}
            className={`${styles.dot} ${i === index ? styles.dotOn : ''}`}
            onClick={() => go(i)}
          />
        ))}
      </div>
    </div>
  );
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={dir === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
    </svg>
  );
}

/**
 * Escena de respaldo cuando todavía no hay foto. No es un placeholder gris:
 * son capas de degradado y siluetas que comparten el lenguaje visual del
 * resto del home, para que el sitio se pueda mostrar antes de la sesión de fotos.
 */
function GeneratedScene({ scene }: { scene: Slide['scene'] }) {
  return (
    <div className={`${styles.scene} ${styles[scene]}`} aria-hidden="true">
      <div className={styles.sky} />
      <div className={styles.glow} />
      {(scene === 'lanterns' || scene === 'night') && (
        <div className={styles.string}>
          {Array.from({ length: 14 }).map((_, i) => (
            <span key={i} style={{ animationDelay: `${(i % 5) * 0.4}s` }} />
          ))}
        </div>
      )}
      <svg className={styles.hills} viewBox="0 0 900 260" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 190 Q 150 140 300 175 T 620 165 T 900 185 V260 H0Z" opacity=".55" />
        <path d="M0 215 Q 200 175 420 205 T 900 210 V260 H0Z" opacity=".85" />
      </svg>
      <div className={styles.pumpkins}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Pumpkin key={i} lit={i % 2 === 0} />
        ))}
      </div>
    </div>
  );
}

function Pumpkin({ lit }: { lit: boolean }) {
  return (
    <svg viewBox="0 0 64 56" className={lit ? styles.lit : undefined} aria-hidden="true">
      <ellipse cx="32" cy="34" rx="27" ry="21" />
      <ellipse cx="32" cy="34" rx="16" ry="21" opacity=".55" />
      <ellipse cx="32" cy="34" rx="7" ry="21" opacity=".4" />
      <path d="M32 13c-1.5-4 .6-7 4.5-8" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
