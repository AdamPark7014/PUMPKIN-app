'use client';

import { Suspense, useId, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { http } from '@/lib/http';
import { AuthShell, MobileBrand, StatusBanner } from '../_components/AuthShell';
import { authErrorMessage } from '../_lib/errors';
import { IconEye, IconLock, IconMail } from '../_lib/icons';
import styles from '../login.module.scss';

type ResetResponse = {
  message?: string;
};

function passwordChecks(password: string) {
  return {
    length: password.length >= 8,
    letter: /[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(password),
    number: /\d/.test(password),
  };
}

function ResetForm() {
  const params = useSearchParams();
  const router = useRouter();
  const errorId = useId();
  const passwordErrorId = useId();
  const confirmErrorId = useId();

  const email = params.get('email')?.trim() ?? '';
  const token = params.get('token')?.trim() ?? '';
  const linkValid = Boolean(email && token);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const checks = useMemo(() => passwordChecks(password), [password]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');

    let ok = true;
    if (!checks.length) {
      setPasswordError('La contraseña debe tener al menos 8 caracteres.');
      ok = false;
    } else {
      setPasswordError('');
    }

    if (!confirm) {
      setConfirmError('Confirma tu nueva contraseña.');
      ok = false;
    } else if (confirm !== password) {
      setConfirmError('Las contraseñas no coinciden.');
      ok = false;
    } else {
      setConfirmError('');
    }

    if (!ok || !linkValid) return;

    setLoading(true);
    try {
      await http<ResetResponse>('/auth/reset-password', {
        method: 'POST',
        auth: false,
        body: { email, token, password },
      });
      setSuccess(true);
      window.setTimeout(() => {
        router.push('/login');
      }, 1600);
    } catch (err) {
      setError(
        authErrorMessage(
          err,
          'No se pudo actualizar la contraseña. Solicita un enlace nuevo.',
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  if (!linkValid) {
    return (
      <>
        <MobileBrand />
        <header className={styles.cardHeader}>
          <h1>Enlace no válido</h1>
          <p>Faltan parámetros de seguridad o el enlace está incompleto.</p>
        </header>
        <StatusBanner tone="error">
          Este enlace de restablecimiento no es válido. Solicita uno nuevo desde la
          pantalla de recuperación.
        </StatusBanner>
        <div className={styles.form} style={{ marginTop: '1.25rem' }}>
          <Link href="/login/forgot" className={styles.submitLink}>
            Solicitar nuevo enlace
          </Link>
          <Link href="/login" className={styles.linkBtn}>
            ← Volver al inicio de sesión
          </Link>
        </div>
      </>
    );
  }

  if (success) {
    return (
      <>
        <MobileBrand />
        <header className={styles.cardHeader}>
          <h1>Contraseña actualizada</h1>
          <p>Ya puedes iniciar sesión con tu nueva contraseña.</p>
        </header>
        <StatusBanner tone="success">
          Contraseña actualizada. Te redirigimos al inicio de sesión…
        </StatusBanner>
        <div className={styles.form} style={{ marginTop: '1.25rem' }}>
          <Link href="/login" className={styles.submitLink}>
            Ir al inicio de sesión
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <MobileBrand />
      <header className={styles.cardHeader}>
        <h1>Nueva contraseña</h1>
        <p>Elige una contraseña segura para tu cuenta de administración.</p>
      </header>

      <form
        className={styles.form}
        onSubmit={onSubmit}
        noValidate
        aria-busy={loading}
        aria-describedby={error ? errorId : undefined}
      >
        <div className={styles.field}>
          <label htmlFor="reset-email">Email</label>
          <div className={styles.inputWrap}>
            <span className={styles.inputIcon}>
              <IconMail />
            </span>
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
            <span className={styles.inputIcon}>
              <IconLock />
            </span>
            <input
              id="reset-password"
              name="password"
              type={showPass ? 'text' : 'password'}
              autoComplete="new-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (passwordError) setPasswordError('');
                if (error) setError('');
              }}
              minLength={8}
              required
              disabled={loading}
              aria-invalid={passwordError ? true : undefined}
              aria-describedby={passwordError ? passwordErrorId : 'reset-password-rules'}
            />
            <button
              type="button"
              className={styles.eyeBtn}
              onClick={() => setShowPass((v) => !v)}
              aria-label={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              aria-pressed={showPass}
              disabled={loading}
            >
              <IconEye open={showPass} />
            </button>
          </div>
          {passwordError ? (
            <p id={passwordErrorId} className={styles.fieldError}>
              {passwordError}
            </p>
          ) : (
            <ul id="reset-password-rules" className={styles.passwordRules}>
              <li data-ok={checks.length}>Al menos 8 caracteres</li>
              <li data-ok={checks.letter}>Incluye una letra</li>
              <li data-ok={checks.number}>Incluye un número</li>
            </ul>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor="reset-confirm">Confirmar contraseña</label>
          <div className={styles.inputWrap}>
            <span className={styles.inputIcon}>
              <IconLock />
            </span>
            <input
              id="reset-confirm"
              name="confirm"
              type={showPass ? 'text' : 'password'}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
                if (confirmError) setConfirmError('');
                if (error) setError('');
              }}
              minLength={8}
              required
              disabled={loading}
              aria-invalid={confirmError ? true : undefined}
              aria-describedby={confirmError ? confirmErrorId : undefined}
            />
          </div>
          {confirmError ? (
            <p id={confirmErrorId} className={styles.fieldError}>
              {confirmError}
            </p>
          ) : null}
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
              Guardando…
            </>
          ) : (
            'Guardar contraseña'
          )}
        </button>

        <Link href="/login" className={styles.linkBtn}>
          ← Volver al inicio de sesión
        </Link>
      </form>
    </>
  );
}

function ResetFallback() {
  return (
    <div className={styles.centerState} role="status" aria-live="polite">
      <span className={styles.spinnerDark} aria-hidden="true" />
      <h1>Cargando…</h1>
      <p>Preparando el formulario de restablecimiento.</p>
    </div>
  );
}

export default function AdminResetPasswordPage() {
  return (
    <AuthShell>
      <Suspense fallback={<ResetFallback />}>
        <ResetForm />
      </Suspense>
    </AuthShell>
  );
}
