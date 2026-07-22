'use client';

import { FormEvent, Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import styles from '../login.module.scss';

const API = process.env.NEXT_PUBLIC_ADMIN_API_URL || 'http://localhost:4000/api/v1';

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
      {msg && <p>{msg}</p>}
      <Link href="/login">Login</Link>
    </form>
  );
}

export default function AdminResetPasswordPage() {
  return (
    <main className={styles.page}>
      <Suspense fallback={<p>Cargando…</p>}>
        <ResetForm />
      </Suspense>
    </main>
  );
}
