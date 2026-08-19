'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { http } from '@/lib/http';
import { useSession } from '@/lib/use-session';
import { AuthShell, MobileBrand, StatusBanner } from './_components/AuthShell';
import { authErrorMessage, isValidEmail } from './_lib/errors';
import {
  IconArrowRight,
  IconEye,
  IconGoogle,
  IconLock,
  IconMail,
  IconMicrosoft,
} from './_lib/icons';
import { oauthStartUrl, type OauthProvider } from './_lib/oauth';
import styles from './login.module.scss';

type LoginResponse = {
  accessToken?: string;
};

export default function LoginPage() {
  const router = useRouter();
  const { status, refresh, setToken } = useSession();
  const errorId = useId();
  const emailErrorId = useId();
  const passwordErrorId = useId();
  const emailRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [remember, setRemember] = useState(true);
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [ssoProvider, setSsoProvider] = useState<OauthProvider | null>(null);

  useEffect(() => {
    if (status === 'authenticated') {
      router.replace('/dashboard');
    }
  }, [router, status]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  function validate(): boolean {
    let ok = true;
    const trimmed = email.trim();
    if (!trimmed) {
      setEmailError('Ingresa tu email corporativo.');
      ok = false;
    } else if (!isValidEmail(trimmed)) {
      setEmailError('El email no tiene un formato válido.');
      ok = false;
    } else {
      setEmailError('');
    }

    if (!password) {
      setPasswordError('Ingresa tu contraseña.');
      ok = false;
    } else {
      setPasswordError('');
    }
    return ok;
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    if (!validate()) {
      emailRef.current?.focus();
      return;
    }

    setLoading(true);
    try {
      const { accessToken } = await http<LoginResponse>('/auth/login', {
        method: 'POST',
        auth: false,
        body: { email: email.trim(), password },
      });
      if (accessToken) setToken(accessToken);
      await refresh();
      router.push('/dashboard');
    } catch (err) {
      setError(
        authErrorMessage(err, 'Credenciales inválidas. Verifica tu email y contraseña.'),
      );
    } finally {
      setLoading(false);
    }
  }

  function startOauth(provider: OauthProvider) {
    if (loading || ssoProvider) return;
    setError('');
    setSsoProvider(provider);
    window.location.href = oauthStartUrl(provider, window.location.origin);
  }

  const busy = loading || ssoProvider !== null;

  if (status === 'authenticated' || status === 'loading') {
    return (
      <AuthShell compact>
        <div className={styles.centerState} role="status" aria-live="polite">
          <span className={styles.spinnerDark} aria-hidden="true" />
          <h1>Preparando tu sesión…</h1>
          <p>Un momento mientras verificamos el acceso al panel.</p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <MobileBrand />

      <header className={styles.cardHeader}>
        <h1>Bienvenido de vuelta</h1>
        <p>Inicia sesión para acceder a tu panel de administración.</p>
      </header>

      <form
        onSubmit={submit}
        className={styles.form}
        noValidate
        aria-busy={busy}
        aria-describedby={error ? errorId : undefined}
      >
        <div className={styles.field}>
          <label htmlFor="admin-email">Email corporativo</label>
          <div className={styles.inputWrap}>
            <span className={styles.inputIcon}>
              <IconMail />
            </span>
            <input
              ref={emailRef}
              id="admin-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (emailError) setEmailError('');
                if (error) setError('');
              }}
              placeholder="tu@pumpkinzone.mx"
              required
              disabled={busy}
              aria-invalid={emailError ? true : undefined}
              aria-describedby={emailError ? emailErrorId : undefined}
            />
          </div>
          {emailError ? (
            <p id={emailErrorId} className={styles.fieldError}>
              {emailError}
            </p>
          ) : null}
        </div>

        <div className={styles.field}>
          <div className={styles.labelRow}>
            <label htmlFor="admin-password">Contraseña</label>
            <Link className={styles.forgot} href="/login/forgot">
              ¿Olvidaste tu contraseña?
            </Link>
          </div>
          <div className={styles.inputWrap}>
            <span className={styles.inputIcon}>
              <IconLock />
            </span>
            <input
              id="admin-password"
              name="password"
              type={showPass ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (passwordError) setPasswordError('');
                if (error) setError('');
              }}
              placeholder="••••••••"
              required
              disabled={busy}
              aria-invalid={passwordError ? true : undefined}
              aria-describedby={passwordError ? passwordErrorId : undefined}
            />
            <button
              type="button"
              className={styles.eyeBtn}
              onClick={() => setShowPass((v) => !v)}
              aria-label={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              aria-pressed={showPass}
              disabled={busy}
            >
              <IconEye open={showPass} />
            </button>
          </div>
          {passwordError ? (
            <p id={passwordErrorId} className={styles.fieldError}>
              {passwordError}
            </p>
          ) : null}
        </div>

        <label className={styles.remember}>
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            disabled={busy}
          />
          <span>Mantener sesión iniciada en este dispositivo</span>
        </label>

        {error ? (
          <div ref={errorRef} tabIndex={-1}>
            <StatusBanner id={errorId} tone="error">
              {error}
            </StatusBanner>
          </div>
        ) : null}

        <button type="submit" className={styles.submit} disabled={busy}>
          {loading ? (
            <>
              <span className={styles.spinner} aria-hidden="true" />
              Verificando credenciales…
            </>
          ) : (
            <>
              Entrar al panel
              <IconArrowRight />
            </>
          )}
        </button>
      </form>

      <div className={styles.divider}>
        <span>o continúa con</span>
      </div>

      <div className={styles.ssoRow}>
        <button
          type="button"
          className={styles.ssoBtn}
          onClick={() => startOauth('google')}
          disabled={busy}
          aria-busy={ssoProvider === 'google'}
        >
          {ssoProvider === 'google' ? (
            <span className={styles.spinnerDark} aria-hidden="true" />
          ) : (
            <IconGoogle />
          )}
          Google Workspace
        </button>
        <button
          type="button"
          className={styles.ssoBtn}
          onClick={() => startOauth('microsoft')}
          disabled={busy}
          aria-busy={ssoProvider === 'microsoft'}
        >
          {ssoProvider === 'microsoft' ? (
            <span className={styles.spinnerDark} aria-hidden="true" />
          ) : (
            <IconMicrosoft />
          )}
          Microsoft 365
        </button>
      </div>

      <p className={styles.footer}>
        ¿Eres organizador nuevo?{' '}
        <a href="mailto:soporte@boletera.app">Solicita acceso al equipo</a>
      </p>
    </AuthShell>
  );
}
