'use client';

import { useEffect, useState } from 'react';
import type { Slide } from '@/lib/event-config';
import styles from './HeroCarousel.module.scss';

type Props = { slides: Slide[]; intervalMs?: number };

/**
 * Fondo del hero: las escenas del evento en rotación con crossfade y un
 * Ken Burns sutil. Vive DEBAJO del contenido del hero — el scrim que da
 * contraste al texto lo pone el propio hero encima de esto.
 */
export function HeroCarousel({ slides, intervalMs = 6500 }: Props) {
  const [index, setIndex] = useState(0);
  const count = slides.length;

  useEffect(() => {
    if (count < 2) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const id = window.setInterval(() => {
      // La pestaña oculta no rota: evita saltos raros al volver.
      if (!document.hidden) setIndex((i) => (i + 1) % count);
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [count, intervalMs]);

  return (
    <>
      <div className={styles.stage} aria-hidden="true">
        {slides.map((slide, i) => (
          <img
            key={slide.id}
            src={slide.src ?? ''}
            alt=""
            className={`${styles.scene} ${i === index ? styles.on : ''}`}
            loading={i === 0 ? 'eager' : 'lazy'}
            draggable={false}
          />
        ))}
      </div>

      <div className={styles.picker}>
        <span className={styles.pickerLabel}>{slides[index]?.title}</span>
        <div className={styles.dots} role="tablist" aria-label="Escena de fondo">
          {slides.map((slide, i) => (
            <button
              key={slide.id}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={slide.title}
              className={`${styles.dot} ${i === index ? styles.dotOn : ''}`}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
      </div>
    </>
  );
}
