'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { SiteHeader } from '@/components/SiteHeader';
import styles from '../login.module.scss';
import { Suspense } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

function ResetForm() {
  const params = useSearchParams();
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const email = params.get('email') || '';
  const token = params.get('token') || '';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const res = await fetch(`${API}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, token, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.message || 'Token inválido');
      return;
    }
    setMsg(data.message);
    setTimeout(() => router.push('/login'), 1500);
  }

  return (
    <form className={styles.card} onSubmit={onSubmit}>
      <h1>Nueva contraseña</h1>
      <label>
        Email
        <input type="email" value={email} readOnly />
      </label>
      <label>
        Nueva contraseña
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
        />
      </label>
      <button type="submit">Guardar</button>
      {msg && <p className={styles.hint}>{msg}</p>}
      <Link href="/login">Login</Link>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <>
      <SiteHeader />
      <main className={styles.page}>
        <Suspense fallback={<p>Cargando…</p>}>
          <ResetForm />
        </Suspense>
      </main>
    </>
  );
}
