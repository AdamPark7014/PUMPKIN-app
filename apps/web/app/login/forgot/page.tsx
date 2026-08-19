'use client';

import { FormEvent, Suspense, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { SiteHeader } from '@/components/SiteHeader';
import { api, errorMessage } from '@/lib/api';
import { safeNextPath } from '@/lib/auth';
import styles from '../login.module.scss';

type ForgotResponse = {
  message?: string;
  devResetUrl?: string;
};

function ForgotForm() {
  const params = useSearchParams();
  const nextPath = useMemo(() => safeNextPath(params.get('next')), [params]);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [devUrl, setDevUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const submitLock = useRef(false);

  const loginHref = nextPath
    ? `/login?next=${encodeURIComponent(nextPath)}`
    : '/login';

  function validate(): string | null {
    const normalized = email.trim();
    if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      return 'Escribe un correo electrónico válido.';
    }
    return null;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitLock.current || loading) return;

    setError('');
    setSuccess('');
    setDevUrl(null);

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    submitLock.current = true;
    setLoading(true);
    try {
      const data = await api<ForgotResponse>('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim() }),
      });
      setSuccess(
        data.message ||
          'Si el correo está registrado, te enviamos un enlace para restablecer tu contraseña.',
      );
      if (typeof data.devResetUrl === 'string' && data.devResetUrl) {
        setDevUrl(data.devResetUrl);
      }
    } catch (cause: unknown) {
      setError(errorMessage(cause, 'No se pudo enviar la solicitud. Inténtalo de nuevo.'));
    } finally {
      submitLock.current = false;
      setLoading(false);
    }
  }

  return (
    <>
      <SiteHeader theme="dark" />
      <main className={styles.page}>
        <div className={styles.glow} aria-hidden="true" />
        <div className={styles.right}>
          <div className={styles.card}>
            <header className={styles.cardHead}>
              <h1>Recuperar contraseña</h1>
              <p>Te enviaremos un enlace si el correo está registrado.</p>
            </header>

            <form className={styles.form} onSubmit={onSubmit} noValidate aria-busy={loading}>
              <div className={styles.field}>
                <label htmlFor="forgot-email">Correo electrónico</label>
                <div className={styles.inputWrap}>
                  <input
                    id="forgot-email"
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="tu@correo.com"
                    maxLength={255}
                    disabled={loading}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? 'forgot-error' : undefined}
                    required
                  />
                </div>
              </div>

              <div
                id="forgot-error"
                className={error ? styles.error : styles.srOnly}
                role="alert"
                aria-live="assertive"
              >
                {error}
              </div>

              {success && (
                <div className={styles.success} role="status" aria-live="polite">
                  {success}
                </div>
              )}

              {devUrl && (
                <p className={styles.devHint}>
                  Enlace de desarrollo:{' '}
                  <Link href={devUrl.replace(/^https?:\/\/[^/]+/, '')}>{devUrl}</Link>
                </p>
              )}

              <button type="submit" className={styles.submit} disabled={loading}>
                {loading ? (
                  <>
                    <span className={styles.spinner} aria-hidden="true" />
                    Enviando…
                  </>
                ) : (
                  'Enviar enlace'
                )}
              </button>
            </form>

            <Link className={styles.backLink} href={loginHref}>
              Volver al inicio de sesión
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}

function AuthFallback() {
  return (
    <>
      <SiteHeader theme="dark" />
      <main className={styles.page}>
        <div className={styles.loadingCard} role="status">
          <span className={styles.spinnerDark} aria-hidden="true" />
          Cargando…
        </div>
      </main>
    </>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<AuthFallback />}>
      <ForgotForm />
    </Suspense>
  );
}
