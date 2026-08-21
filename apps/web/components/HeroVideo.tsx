'use client';

import { useEffect, useState } from 'react';

const DESKTOP_SRC = '/pumpkin/hero-desktop.mp4';
const MOBILE_SRC = '/pumpkin/hero-mobile.mp4';
const MOBILE_MQ = '(max-width: 720px)';

type Props = {
  className?: string;
  label: string;
};

/**
 * Elige el master 16:9 o 9:16 según el viewport para no descargar ambos.
 */
export function HeroVideo({ className, label }: Props) {
  const [src, setSrc] = useState(DESKTOP_SRC);

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ);
    const sync = () => setSrc(mq.matches ? MOBILE_SRC : DESKTOP_SRC);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  return (
    <video
      key={src}
      className={className}
      src={src}
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      aria-label={label}
    />
  );
}
