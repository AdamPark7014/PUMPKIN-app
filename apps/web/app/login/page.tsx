'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@boletera/ui';
import { SiteHeader } from '@/components/SiteHeader';
import { saveSession } from '@/lib/auth';
import styles from './login.module.scss';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

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

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const path = mode === 'login' ? '/auth/login' : '/auth/register';
      const body =
        mode === 'login'
          ? { email, password }
          : { email, password, firstName, lastName };
      const res = await fetch(`${API}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? 'Error de autenticación');
      saveSession(data.accessToken, data.user);
      router.push('/cuenta');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <SiteHeader />
      <main className={styles.page}>
        <div className={styles.glow} aria-hidden="true" />

        <div className={styles.shell}>
          {/* Lado izquierdo: marketing */}
          <aside className={styles.left}>
            <p className={styles.kicker}>Tu cuenta Boletera</p>
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
                Boletos digitales con QR y NFC
              </li>
              <li>
                <span className={styles.check}>✓</span>
                Preventa exclusiva para miembros
              </li>
              <li>
                <span className={styles.check}>✓</span>
                Reventa segura con vendedor verificado
              </li>
            </ul>
            <div className={styles.testimonial}>
              <p>
                “Llevo años usando Boletera para todos mis conciertos. El mapa 3D y los avisos
                de preventa me han salvado de filas eternas.”
              </p>
              <div className={styles.author}>
                <span className={styles.authorAvatar}>M</span>
                <div>
                  <strong>María López</strong>
                  <small>Fan verificada · 38 eventos</small>
                </div>
              </div>
            </div>
          </aside>

          {/* Derecha: formulario */}
          <section className={styles.right}>
            <div className={styles.card}>
              <div className={styles.tabs} role="tablist">
                <button
                  type="button"
                  role="tab"
                  className={mode === 'login' ? styles.tabActive : styles.tab}
                  onClick={() => setMode('login')}
                  aria-selected={mode === 'login'}
                >
                  Iniciar sesión
                </button>
                <button
                  type="button"
                  role="tab"
                  className={mode === 'register' ? styles.tabActive : styles.tab}
                  onClick={() => setMode('register')}
                  aria-selected={mode === 'register'}
                >
                  Crear cuenta
                </button>
              </div>

              <header className={styles.cardHead}>
                <h2>{mode === 'login' ? '¡Hola de nuevo!' : 'Únete a Boletera'}</h2>
                <p>
                  {mode === 'login'
                    ? 'Entra para ver tus boletos y comprar más rápido.'
                    : 'Crea tu cuenta gratuita para comprar y guardar tus boletos.'}
                </p>
              </header>

              <form onSubmit={submit} className={styles.form}>
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
                          required
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div className={styles.field}>
                  <label htmlFor="email">Email</label>
                  <div className={styles.inputWrap}>
                    <span className={styles.icon}>
                      <IconMail />
                    </span>
                    <input
                      id="email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="tu@correo.com"
                      required
                    />
                  </div>
                </div>

                <div className={styles.field}>
                  <div className={styles.labelRow}>
                    <label htmlFor="password">Contraseña</label>
                    {mode === 'login' && (
                      <a className={styles.forgot} href="/login/forgot">
                        ¿Olvidaste tu contraseña?
                      </a>
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
                      minLength={6}
                      required
                    />
                    <button
                      type="button"
                      className={styles.eyeBtn}
                      onClick={() => setShowPass((v) => !v)}
                      aria-label={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    >
                      {showPass ? '🙈' : '👁'}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className={styles.error} role="alert">
                    {error}
                  </div>
                )}

                <Button type="submit" size="lg" className={styles.submit} disabled={loading}>
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
                </Button>

                <div className={styles.divider}>
                  <span>o continúa con</span>
                </div>

                <div className={styles.socials}>
                  <button type="button" className={styles.socialBtn} disabled>
                    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        fill="#4285F4"
                        d="M22 12.2c0-.8-.1-1.4-.2-2H12v3.8h5.7c-.2 1.3-1 2.4-2.1 3.1v2.5h3.4c2-1.8 3-4.5 3-7.4Z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 22c2.7 0 5-.9 6.7-2.4l-3.4-2.5c-.9.6-2 1-3.3 1-2.6 0-4.7-1.7-5.5-4H3v2.5C4.8 19.8 8.1 22 12 22Z"
                      />
                      <path fill="#FBBC04" d="M6.5 14.1A6 6 0 0 1 6.2 12c0-.7.1-1.4.3-2.1V7.4H3a10 10 0 0 0 0 9.1l3.5-2.4Z" />
                      <path
                        fill="#EA4335"
                        d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9C16.9 2.9 14.7 2 12 2 8.1 2 4.8 4.2 3 7.4l3.5 2.5C7.3 7.6 9.4 5.9 12 5.9Z"
                      />
                    </svg>
                    Google
                  </button>
                  <button type="button" className={styles.socialBtn} disabled>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="#1877F2" aria-hidden="true">
                      <path d="M22 12c0-5.5-4.5-10-10-10S2 6.5 2 12c0 5 3.7 9.1 8.4 9.9V15H8v-3h2.4V9.8C10.4 7.4 11.9 6 14.1 6c1 0 2.1.2 2.1.2v2.4h-1.2c-1.2 0-1.5.7-1.5 1.5V12h2.6l-.4 3h-2.2v6.9c4.7-.8 8.5-4.9 8.5-9.9z" />
                    </svg>
                    Facebook
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
