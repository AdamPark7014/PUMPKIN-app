'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listVenues } from '@/lib/platform-api';
import platform from '../_styles/platform.module.scss';

export default function VenuesPage() {
  const [venues, setVenues] = useState<
    { id: string; name: string; slug: string; city?: string; totalCapacity?: number }[]
  >([]);

  useEffect(() => {
    const token = localStorage.getItem('boletera_token');
    if (!token) return;
    listVenues(token).then(setVenues);
  }, []);

  return (
    <div>
      <header className={platform.pageHeader}>
        <div>
          <h1>Venues y mapas</h1>
          <p>Editor 2D, IA, vista 3D y publicación a eventos</p>
        </div>
      </header>

      <section className={platform.panel}>
        <table className={platform.table}>
          <thead>
            <tr>
              <th>Venue</th>
              <th>Capacidad</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {venues.map((v) => (
              <tr key={v.id}>
                <td>
                  <strong>{v.name}</strong>
                  <br />
                  <small style={{ color: '#737373' }}>{v.slug}</small>
                </td>
                <td>{v.totalCapacity?.toLocaleString() ?? '—'}</td>
                <td style={{ display: 'flex', gap: '0.5rem' }}>
                  <Link href={`/venues/${v.id}/map`} className={platform.primaryBtn}>
                    Editor mapa
                  </Link>
                  <Link href={`/venues/${v.id}/3d`} className={platform.ghostBtn}>
                    3D
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
