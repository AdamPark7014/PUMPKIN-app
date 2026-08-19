'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SiteHeader } from '@/components/SiteHeader';
import { authHeaders, getToken } from '@/lib/auth';
import styles from './vender.module.scss';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

export default function ResaleSellPage() {
  const router = useRouter();
  const [ticketCode, setTicketCode] = useState('');
  const [askingPrice, setAskingPrice] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!getToken()) {
      router.push('/login?next=/resale/vender');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/resale/listings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          ticketCode: ticketCode.trim(),
          askingPrice: Number(askingPrice),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? 'No se pudo publicar');
      router.push('/resale');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.shell}>
      <SiteHeader theme="dark" />
      <main className={styles.page}>
        <p className={styles.eyebrow}>Reventa oficial</p>
        <h1>Vender boleto</h1>
        <p className={styles.lead}>
          Publica un boleto de tu cuenta. El precio debe respetar el tope anti-scalping del evento.
        </p>

        <form onSubmit={submit} className={styles.form}>
          <label>
            Código del boleto
            <input
              value={ticketCode}
              onChange={(e) => setTicketCode(e.target.value)}
              placeholder="Ej. BL-XXXX"
              required
            />
          </label>
          <label>
            Precio de reventa (MXN)
            <input
              type="number"
              min={1}
              value={askingPrice}
              onChange={(e) => setAskingPrice(e.target.value)}
              placeholder="0"
              required
            />
          </label>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <button type="submit" disabled={loading}>
            {loading ? 'Publicando…' : 'Publicar listado'}
          </button>
        </form>

        <Link href="/resale" className={styles.back}>
          ← Volver a reventa
        </Link>
      </main>
    </div>
  );
}
