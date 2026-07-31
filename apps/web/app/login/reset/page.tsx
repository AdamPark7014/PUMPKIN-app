'use client';

import { FormEvent, Suspense, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { SiteHeader } from '@/components/SiteHeader';
import { api, errorMessage } from '@/lib/api';
import { safeNextPath } from '@/lib/auth';
import styles from '../login.module.scss';

type ResetResponse = {
  message?: string;
};

function ResetForm() {
  const params = useSearchParams();
  const router = useRouter();
  const nextPath = useMemo(() => safeNextPath(params.get('next')), [params]);
  const email = params.get('email') || '';
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const submitLock = useRef(false);

  const loginHref = nextPath
    ? `/login?next=${encodeURIComponent(nextPath)}`
    : '/login';

  const missingParams = !email.trim() || !token.trim();

  function validate(): string | null {
    if (missingParams) {
      return 'El enlace de restablecimiento no es válido o está incompleto.';
    }
    if (password.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
    if (password !== confirm) return 'Las contraseñas no coinciden.';
    return null;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitLock.current || loading) return;

    setError('');
    setSuccess('');

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    submitLock.current = true;
    setLoading(true);
    try {
      const data = await api<ResetResponse>('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({
          email: email.trim(),
          token: token.trim(),
          password,
        }),
      });
      setSuccess(data.message || 'Contraseña actualizada. Ya puedes iniciar sesión.');
      window.setTimeout(() => {
        router.replace(loginHref);
      }, 1500);
    } catch (cause: unknown) {
      setError(errorMessage(cause, 'No se pudo restablecer la contraseña. El enlace puede haber expirado.'));
      submitLock.current = false;
      setLoading(false);
    }
  }

  return (
    <>
      <SiteHeader />
      <main className={styles.page}>
        <div className={styles.glow} aria-hidden="true" />
        <div className={styles.right}>
          <div className={styles.card}>
            <header className={styles.cardHead}>
              <h1>Nueva contraseña</h1>
              <p>Elige una contraseña segura de al menos 8 caracteres.</p>
            </header>

            <form className={styles.form} onSubmit={onSubmit} noValidate aria-busy={loading}>
              <div className={styles.field}>
                <label htmlFor="reset-email">Correo electrónico</label>
                <div className={styles.inputWrap}>
                  <input
                    id="reset-email"
                    type="email"
                    value={email}
                    readOnly
                    autoComplete="username"
                    aria-readonly="true"
                  />
                </div>
              </div>

              <div className={styles.field}>
                <label htmlFor="reset-password">Nueva contraseña</label>
                <div className={styles.inputWrap}>
                  <input
                    id="reset-password"
                    type={showPass ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    minLength={8}
                    maxLength={128}
                    disabled={loading || missingParams}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? 'reset-error' : 'reset-help'}
                    required
                  />
                  <button
                    type="button"
                    className={styles.eyeBtn}
                    onClick={() => setShowPass((v) => !v)}
                    aria-label={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    aria-pressed={showPass}
                    disabled={loading}
                  >
                    {showPass ? 'Ocultar' : 'Mostrar'}
                  </button>
                </div>
                <span id="reset-help" className={styles.fieldHint}>
                  Usa al menos 8 caracteres.
                </span>
              </div>

              <div className={styles.field}>
                <label htmlFor="reset-confirm">Confirmar contraseña</label>
                <div className={styles.inputWrap}>
                  <input
                    id="reset-confirm"
                    type={showPass ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="••••••••"
                    minLength={8}
                    maxLength={128}
                    disabled={loading || missingParams}
                    aria-invalid={Boolean(error)}
                    required
                  />
                </div>
              </div>

              <div
                id="reset-error"
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

              <button
                type="submit"
                className={styles.submit}
                disabled={loading || missingParams}
              >
                {loading ? (
                  <>
                    <span className={styles.spinner} aria-hidden="true" />
                    Guardando…
                  </>
                ) : (
                  'Guardar contraseña'
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
      <SiteHeader />
      <main className={styles.page}>
        <div className={styles.loadingCard} role="status">
          <span className={styles.spinnerDark} aria-hidden="true" />
          Cargando…
        </div>
      </main>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<AuthFallback />}>
      <ResetForm />
    </Suspense>
  );
}
