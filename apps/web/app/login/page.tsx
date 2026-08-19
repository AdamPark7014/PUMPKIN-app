'use client';

import { FormEvent, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { api, API_BASE, errorMessage } from '@/lib/api';
import { AuthUser, safeNextPath, saveSession } from '@/lib/auth';
import styles from './login.module.scss';

type AuthResponse = {
  accessToken: string;
  user: AuthUser;
};

type AuthMode = 'login' | 'register';
type OauthProvider = 'google' | 'microsoft';

function loginHref(nextPath: string | null): string {
  return nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : '/login';
}

function IconMail() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="m4 8 8 5 8-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function IconLock() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M8 11V8a4 4 0 1 1 8 0v3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconUser() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M4 21c1-4 4-6 8-6s7 2 8 6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const nextPath = useMemo(() => safeNextPath(params.get('next')), [params]);
  const guestHref = nextPath?.startsWith('/checkout') ? nextPath : '/cart';
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const submitLock = useRef(false);

  const oauthProvider: OauthProvider | null =
    params.get('provider') === 'microsoft'
      ? 'microsoft'
      : params.get('provider') === 'google'
        ? 'google'
        : null;

  useEffect(() => {
    const code = params.get('code');
    const state = params.get('state');
    if (!oauthProvider || !code || !state) return;

    let active = true;
    setLoading(true);
    setError('');

    const base = loginHref(nextPath);
    const redirectUri = `${window.location.origin}${base}${base.includes('?') ? '&' : '?'}provider=${oauthProvider}`;

    void api<AuthResponse>(`/auth/oauth/${oauthProvider}/callback`, {
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({ code, state, redirect_uri: redirectUri }),
    })
      .then((data) => {
        if (!active) return;
        saveSession(data.accessToken, data.user);
        router.replace(nextPath ?? '/cuenta');
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(errorMessage(cause, 'No pudimos completar el acceso con tu proveedor.'));
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [nextPath, oauthProvider, params, router]);

  function changeMode(nextMode: AuthMode) {
    if (loading) return;
    setMode(nextMode);
    setError('');
  }

  function validate(): string | null {
    const normalizedEmail = email.trim();
    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return 'Escribe un correo electrónico válido.';
    }
    if (password.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
    if (mode === 'register' && !firstName.trim()) return 'Escribe tu nombre.';
    if (mode === 'register' && !lastName.trim()) return 'Escribe tu apellido.';
    return null;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (submitLock.current || loading) return;
    setError('');
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    submitLock.current = true;
    setLoading(true);
    try {
      const path = mode === 'login' ? '/auth/login' : '/auth/register';
      const body =
        mode === 'login'
          ? { email: email.trim(), password }
          : {
              email: email.trim(),
              password,
              firstName: firstName.trim(),
              lastName: lastName.trim(),
            };
      const data = await api<AuthResponse>(path, {
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify(body),
      });
      saveSession(data.accessToken, data.user);
      router.replace(nextPath ?? '/cuenta');
    } catch (cause: unknown) {
      setError(
        errorMessage(
          cause,
          mode === 'login'
            ? 'No pudimos iniciar sesión. Revisa tus datos.'
            : 'No pudimos crear tu cuenta.',
        ),
      );
      submitLock.current = false;
      setLoading(false);
    }
  }

  function startOauth(provider: OauthProvider) {
    if (loading) return;
    setLoading(true);
    setError('');
    const base = loginHref(nextPath);
    const redirect = `${window.location.origin}${base}${base.includes('?') ? '&' : '?'}provider=${provider}`;
    window.location.assign(
      `${API_BASE}/auth/oauth/${provider}/start?redirect_uri=${encodeURIComponent(redirect)}`,
    );
  }

  const forgotHref = nextPath
    ? `/login/forgot?next=${encodeURIComponent(nextPath)}`
    : '/login/forgot';

  return (
    <>
      <SiteHeader theme="dark" />
      <main className={styles.page}>
        <div className={styles.glow} aria-hidden="true" />

        <div className={styles.shell}>
          <aside className={styles.left}>
            <p className={styles.kicker}>Tu cuenta</p>
            <h1>
              Compra rápido,
              <br />
              guarda tus boletos,
              <br />
              <span className={styles.gradient}>nunca pierdas un show.</span>
            </h1>
            <ul className={styles.perks}>
              <li>
                <span className={styles.check}>✓</span>
                Reserva y compra en segundos
              </li>
              <li>
                <span className={styles.check}>✓</span>
                Boletos digitales con QR
              </li>
              <li>
                <span className={styles.check}>✓</span>
                Historial y reenvío de boletos
              </li>
              <li>
                <span className={styles.check}>✓</span>
                Pago como invitado siempre disponible
              </li>
            </ul>
            <div className={styles.guestAside}>
              <strong>Tu compra no depende de una cuenta.</strong>
              <span>Puedes pagar como invitado y recibir tus boletos por correo.</span>
            </div>
          </aside>

          <section className={styles.right}>
            <div className={styles.card}>
              <div className={styles.tabs} role="tablist" aria-label="Acceso">
                <button
                  type="button"
                  role="tab"
                  className={mode === 'login' ? styles.tabActive : styles.tab}
                  onClick={() => changeMode('login')}
                  aria-selected={mode === 'login'}
                  disabled={loading}
                >
                  Iniciar sesión
                </button>
                <button
                  type="button"
                  role="tab"
                  className={mode === 'register' ? styles.tabActive : styles.tab}
                  onClick={() => changeMode('register')}
                  aria-selected={mode === 'register'}
                  disabled={loading}
                >
                  Crear cuenta
                </button>
              </div>

              <header className={styles.cardHead}>
                <h2>{mode === 'login' ? '¡Hola de nuevo!' : 'Crea tu cuenta'}</h2>
                <p>
                  {mode === 'login'
                    ? 'Entra para ver tus boletos y comprar más rápido.'
                    : 'Crea tu cuenta gratuita para guardar y reenviar tus boletos.'}
                </p>
              </header>

              <div className={styles.guestNotice}>
                <span>Puedes pagar como invitado.</span>{' '}
                <Link href={guestHref}>
                  {guestHref.startsWith('/checkout') ? 'Continuar al pago' : 'Ir al carrito'}
                </Link>
              </div>

              <form onSubmit={submit} className={styles.form} noValidate aria-busy={loading}>
                {mode === 'register' && (
                  <div className={styles.row}>
                    <div className={styles.field}>
                      <label htmlFor="first-name">Nombre</label>
                      <div className={styles.inputWrap}>
                        <span className={styles.icon}>
                          <IconUser />
                        </span>
                        <input
                          id="first-name"
                          autoComplete="given-name"
                          value={firstName}
                          onChange={(e) => setFirstName(e.target.value)}
                          placeholder="Tu nombre"
                          maxLength={100}
                          disabled={loading}
                          required
                        />
                      </div>
                    </div>
                    <div className={styles.field}>
                      <label htmlFor="last-name">Apellido</label>
                      <div className={styles.inputWrap}>
                        <input
                          id="last-name"
                          autoComplete="family-name"
                          value={lastName}
                          onChange={(e) => setLastName(e.target.value)}
                          placeholder="Apellido"
                          maxLength={100}
                          disabled={loading}
                          required
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div className={styles.field}>
                  <label htmlFor="email">Correo electrónico</label>
                  <div className={styles.inputWrap}>
                    <span className={styles.icon}>
                      <IconMail />
                    </span>
                    <input
                      id="email"
                      type="email"
                      autoComplete="email"
                      inputMode="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="tu@correo.com"
                      maxLength={255}
                      disabled={loading}
                      aria-invalid={Boolean(error)}
                      aria-describedby={error ? 'auth-error' : undefined}
                      required
                    />
                  </div>
                </div>

                <div className={styles.field}>
                  <div className={styles.labelRow}>
                    <label htmlFor="password">Contraseña</label>
                    {mode === 'login' && (
                      <Link className={styles.forgot} href={forgotHref}>
                        ¿Olvidaste tu contraseña?
                      </Link>
                    )}
                  </div>
                  <div className={styles.inputWrap}>
                    <span className={styles.icon}>
                      <IconLock />
                    </span>
                    <input
                      id="password"
                      type={showPass ? 'text' : 'password'}
                      autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      minLength={8}
                      maxLength={128}
                      disabled={loading}
                      aria-invalid={Boolean(error)}
                      aria-describedby={
                        error ? 'auth-error' : mode === 'register' ? 'password-help' : undefined
                      }
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
                  {mode === 'register' && (
                    <span id="password-help" className={styles.fieldHint}>
                      Usa al menos 8 caracteres.
                    </span>
                  )}
                </div>

                <div
                  id="auth-error"
                  className={error ? styles.error : styles.srOnly}
                  role="alert"
                  aria-live="assertive"
                >
                  {error}
                </div>

                <button type="submit" className={styles.submit} disabled={loading}>
                  {loading ? (
                    <>
                      <span className={styles.spinner} aria-hidden="true" />
                      Procesando…
                    </>
                  ) : mode === 'login' ? (
                    <>
                      Entrar
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path
                          d="M5 12h14m-5-5 5 5-5 5"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </>
                  ) : (
                    'Crear cuenta gratis'
                  )}
                </button>

                <div className={styles.divider}>
                  <span>o continúa con</span>
                </div>

                <div className={styles.socials}>
                  <button
                    type="button"
                    className={styles.socialBtn}
                    onClick={() => startOauth('google')}
                    disabled={loading}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        fill="#4285F4"
                        d="M22 12.2c0-.8-.1-1.4-.2-2H12v3.8h5.7c-.2 1.3-1 2.4-2.1 3.1v2.5h3.4c2-1.8 3-4.5 3-7.4Z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 22c2.7 0 5-.9 6.7-2.4l-3.4-2.5c-.9.6-2 1-3.3 1-2.6 0-4.7-1.7-5.5-4H3v2.5C4.8 19.8 8.1 22 12 22Z"
                      />
                      <path
                        fill="#FBBC04"
                        d="M6.5 14.1A6 6 0 0 1 6.2 12c0-.7.1-1.4.3-2.1V7.4H3a10 10 0 0 0 0 9.1l3.5-2.4Z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9C16.9 2.9 14.7 2 12 2 8.1 2 4.8 4.2 3 7.4l3.5 2.5C7.3 7.6 9.4 5.9 12 5.9Z"
                      />
                    </svg>
                    Google
                  </button>
                  <button
                    type="button"
                    className={styles.socialBtn}
                    onClick={() => startOauth('microsoft')}
                    disabled={loading}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                      <path fill="#f35325" d="M2 2h9.5v9.5H2z" />
                      <path fill="#81bc06" d="M12.5 2H22v9.5h-9.5z" />
                      <path fill="#05a6f0" d="M2 12.5h9.5V22H2z" />
                      <path fill="#ffba08" d="M12.5 12.5H22V22h-9.5z" />
                    </svg>
                    Microsoft
                  </button>
                </div>
              </form>

              <p className={styles.terms}>
                Al continuar aceptas los{' '}
                <Link href="/terminos">Términos</Link> y la{' '}
                <Link href="/privacidad">Política de privacidad</Link>.
              </p>
            </div>
          </section>
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
          Preparando acceso…
        </div>
      </main>
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<AuthFallback />}>
      <LoginForm />
    </Suspense>
  );
}
