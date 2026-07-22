'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { authHeaders, getToken } from '@/lib/auth';
import { useRouter } from 'next/navigation';

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
      router.push('/login');
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
    <main style={{ maxWidth: 480, margin: '0 auto', padding: '2rem 1.5rem' }}>
      <SiteHeader />
      <h1>Vender boleto</h1>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <label>
          Código del boleto
          <input value={ticketCode} onChange={(e) => setTicketCode(e.target.value)} required />
        </label>
        <label>
          Precio de reventa (MXN)
          <input
            type="number"
            min={1}
            value={askingPrice}
            onChange={(e) => setAskingPrice(e.target.value)}
            required
          />
        </label>
        {error && <p style={{ color: '#c53030' }}>{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? 'Publicando…' : 'Publicar listado'}
        </button>
      </form>
      <Link href="/resale" style={{ display: 'block', marginTop: '1rem' }}>
        ← Volver a reventa
      </Link>
    </main>
  );
}
