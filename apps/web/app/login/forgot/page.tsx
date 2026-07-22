'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import styles from '../login.module.scss';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [devUrl, setDevUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    setDevUrl(null);
    try {
      const res = await fetch(`${API}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      setMsg(data.message || 'Revisa tu correo');
      if (data.devResetUrl) setDevUrl(data.devResetUrl);
    } catch {
      setMsg('No se pudo enviar la solicitud');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <SiteHeader />
      <main className={styles.page}>
        <form className={styles.card} onSubmit={onSubmit}>
          <h1>Recuperar contraseña</h1>
          <p className={styles.sub}>Te enviaremos un enlace si el correo está registrado.</p>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <button type="submit" disabled={loading}>
            {loading ? 'Enviando…' : 'Enviar enlace'}
          </button>
          {msg && <p className={styles.hint}>{msg}</p>}
          {devUrl && (
            <p className={styles.hint}>
              Dev:{' '}
              <Link href={devUrl.replace(/^https?:\/\/[^/]+/, '')}>{devUrl}</Link>
            </p>
          )}
          <Link href="/login">Volver al login</Link>
        </form>
      </main>
    </>
  );
}
