'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useOrgId } from '@/lib/use-org';
import platform from '../_styles/platform.module.scss';

const API = process.env.NEXT_PUBLIC_ADMIN_API_URL || 'http://localhost:4000/api/v1';

type SeasonPass = {
  id: string;
  name: string;
  slug: string;
  seasonLabel: string;
  price: string | number;
  soldQuantity: number;
  maxQuantity: number;
  active: boolean;
  events: { event: { id: string; title: string } }[];
};

export default function SeasonPassesPage() {
  const orgId = useOrgId();
  const [rows, setRows] = useState<SeasonPass[]>([]);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [seasonLabel, setSeasonLabel] = useState('2026-2027');
  const [price, setPrice] = useState('4500');

  function reload() {
    const token = localStorage.getItem('boletera_token');
    if (!token || !orgId) return;
    fetch(`${API}/season/org/${orgId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then(setRows)
      .catch(() => setRows([]));
  }

  useEffect(() => {
    reload();
  }, [orgId]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem('boletera_token');
    if (!token || !orgId) return;
    const startsAt = new Date().toISOString();
    const endsAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    await fetch(`${API}/season/org/${orgId}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name,
        slug: slug || name.toLowerCase().replace(/\s+/g, '-'),
        seasonLabel,
        startsAt,
        endsAt,
        price: Number(price),
      }),
    });
    setName('');
    setSlug('');
    reload();
  }

  return (
    <div>
      <header className={platform.pageHeader}>
        <div>
          <h1>Abonos / temporadas</h1>
          <p>Pases de temporada ligados a múltiples eventos del venue</p>
        </div>
      </header>

      <section className={platform.panel}>
        <form onSubmit={onCreate} style={{ display: 'grid', gap: '0.75rem', maxWidth: 480 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" required />
          <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="slug" />
          <input
            value={seasonLabel}
            onChange={(e) => setSeasonLabel(e.target.value)}
            placeholder="Temporada"
            required
          />
          <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Precio MXN" required />
          <button type="submit" className={platform.primaryBtn}>
            Crear abono
          </button>
        </form>
      </section>

      <section className={platform.panel}>
        <table className={platform.table}>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Temporada</th>
              <th>Precio</th>
              <th>Vendidos</th>
              <th>Eventos</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>{r.seasonLabel}</td>
                <td>${Number(r.price).toLocaleString('es-MX')}</td>
                <td>
                  {r.soldQuantity}/{r.maxQuantity}
                </td>
                <td>{r.events?.length ?? 0}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={5}>Sin abonos aún</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
