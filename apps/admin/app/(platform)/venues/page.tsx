'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Legacy /venues → hub del creador de mapas */
export default function VenuesRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/maps');
  }, [router]);
  return <p>Redirigiendo al creador de mapas…</p>;
}
