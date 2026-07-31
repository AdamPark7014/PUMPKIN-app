'use client';

import { useId, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { http } from '@/lib/http';
import { AuthShell, MobileBrand, StatusBanner } from '../_components/AuthShell';
import { authErrorMessage, isValidEmail } from '../_lib/errors';
import { IconMail } from '../_lib/icons';
import styles from '../login.module.scss';

type ForgotResponse = {
  message?: string;
  devResetUrl?: string;
};

export default function AdminForgotPasswordPage() {
  const errorId = useId();
  const emailErrorId = useId();
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [devUrl, setDevUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setDevUrl(null);

    const trimmed = email.trim();
    if (!trimmed) {
      setEmailError('Ingresa el email de tu cuenta.');
      return;
    }
    if (!isValidEmail(trimmed)) {
      setEmailError('El email no tiene un formato válido.');
      return;
    }
    setEmailError('');
    setLoading(true);

    try {
      const data = await http<ForgotResponse>('/auth/forgot-password', {
        method: 'POST',
        auth: false,
        body: { email: trimmed },
      });
      setSuccess(true);
      if (typeof data.devResetUrl === 'string' && data.devResetUrl) {
        try {
          const u = new URL(data.devResetUrl);
          setDevUrl(`/login/reset${u.search}`);
        } catch {
          setDevUrl(null);
        }
      }
    } catch (err) {
      setError(
        authErrorMessage(err, 'No se pudo enviar la solicitud. Intenta de nuevo.'),
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <MobileBrand />

      <header className={styles.cardHeader}>
        <h1>Recuperar contraseña</h1>
        <p>
          Te enviaremos un enlace de restablecimiento si el correo está registrado en
          la organización.
        </p>
      </header>

      {success ? (
        <div className={styles.form}>
          <StatusBanner tone="success">
            Si el correo existe, enviamos instrucciones. Revisa tu bandeja de entrada y
            la carpeta de spam.
          </StatusBanner>

          {devUrl ? (
            <StatusBanner tone="info">
              Entorno de desarrollo:{' '}
              <Link href={devUrl} className={styles.linkBtn}>
                Abrir enlace de restablecimiento
              </Link>
            </StatusBanner>
          ) : null}

          <Link href="/login" className={styles.submitLink}>
            Volver al inicio de sesión
          </Link>
        </div>
      ) : (
        <form
          className={styles.form}
          onSubmit={onSubmit}
          noValidate
          aria-busy={loading}
          aria-describedby={error ? errorId : undefined}
        >
          <div className={styles.field}>
            <label htmlFor="forgot-email">Email corporativo</label>
            <div className={styles.inputWrap}>
              <span className={styles.inputIcon}>
                <IconMail />
              </span>
              <input
                id="forgot-email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (emailError) setEmailError('');
                  if (error) setError('');
                }}
                placeholder="tu@empresa.com"
                required
                disabled={loading}
                aria-invalid={emailError ? true : undefined}
                aria-describedby={emailError ? emailErrorId : undefined}
              />
            </div>
            {emailError ? (
              <p id={emailErrorId} className={styles.fieldError}>
                {emailError}
              </p>
            ) : (
              <p className={styles.fieldHint}>
                Por seguridad no indicamos si el correo está registrado.
              </p>
            )}
          </div>

          {error ? (
            <StatusBanner id={errorId} tone="error">
              {error}
            </StatusBanner>
          ) : null}

          <button type="submit" className={styles.submit} disabled={loading}>
            {loading ? (
              <>
                <span className={styles.spinner} aria-hidden="true" />
                Enviando enlace…
              </>
            ) : (
              'Enviar enlace'
            )}
          </button>

          <Link href="/login" className={styles.linkBtn}>
            ← Volver al inicio de sesión
          </Link>
        </form>
      )}
    </AuthShell>
  );
}
