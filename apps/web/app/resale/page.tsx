import Link from 'next/link';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

export default async function ResalePage() {
  let listings: { id: string; askingPrice: string; status: string }[] = [];
  try {
    const res = await fetch(`${API}/resale/listings?limit=20`, { cache: 'no-store' });
    const data = await res.json();
    listings = data.listings ?? [];
  } catch {
    listings = [];
  }

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '2rem 1.5rem' }}>
      <Link href="/" style={{ fontSize: '0.875rem', color: '#737373' }}>
        ← Inicio
      </Link>
      <h1 style={{ marginTop: '1rem', fontSize: '1.75rem', fontWeight: 600 }}>Reventa oficial</h1>
      <p style={{ color: '#737373', marginBottom: '1.5rem' }}>
        Boletos verificados en mercado secundario con precios controlados anti-scalping.
      </p>
      <p style={{ marginBottom: '1.5rem' }}>
        <Link href="/resale/vender" style={{ fontWeight: 600 }}>
          Vender mi boleto →
        </Link>
      </p>
      <ul style={{ listStyle: 'none' }}>
        {listings.map((l) => (
          <li
            key={l.id}
            style={{
              padding: '1rem',
              border: '1px solid #d4d4d4',
              borderRadius: 8,
              marginBottom: '0.75rem',
            }}
          >
            Listado {l.id.slice(0, 8)} — ${l.askingPrice} — {l.status}
          </li>
        ))}
      </ul>
      {!listings.length && <p style={{ color: '#737373' }}>No hay listados por ahora.</p>}
    </main>
  );
}
