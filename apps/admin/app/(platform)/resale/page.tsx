'use client';

import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_ADMIN_API_URL || 'http://localhost:4000/api/v1';

interface Listing {
  id: string;
  askingPrice: string;
  status: string;
  ticket: { code: string };
}

export default function ResaleAdminPage() {
  const [listings, setListings] = useState<Listing[]>([]);

  useEffect(() => {
    fetch(`${API}/resale/listings?limit=30`)
      .then((r) => r.json())
      .then((d) => setListings(d.listings ?? d ?? []))
      .catch(() => {});
  }, []);

  return (
    <div>
      <h1>Reventa (marketplace)</h1>
      <ul style={{ marginTop: '1rem', listStyle: 'none' }}>
        {listings.map((l) => (
          <li key={l.id} style={{ padding: '0.75rem 0', borderBottom: '1px solid #e5e5e5' }}>
            <strong>{l.ticket?.code ?? l.id}</strong> — ${l.askingPrice} — {l.status}
          </li>
        ))}
      </ul>
      {!listings.length && <p style={{ color: '#737373' }}>Sin listados activos.</p>}
    </div>
  );
}
