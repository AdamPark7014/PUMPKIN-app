'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { http } from '@/lib/http';
import { useSession } from '@/lib/use-session';
import { AuthShell, StatusBanner } from '../../_components/AuthShell';
import { authErrorMessage } from '../../_lib/errors';
import {
  oauthCallbackRedirectUri,
  resolveOauthProvider,
  type OauthProvider,
} from '../../_lib/oauth';
import styles from '../../login.module.scss';

type OauthCallbackResponse = {
  accessToken?: string;
  user: { email: string; organizationId?: string };
};

type ExchangeResult = {
  accessToken?: string;
};

/**
 * Module-level cache survives React Strict Mode remounts so the one-time
 * OAuth authorization code is exchanged exactly once.
 */
const exchangeCache = new Map<string, Promise<ExchangeResult>>();

function exchangeOauthCode(
  provider: OauthProvider,
  code: string,
  state: string,
  redirectUri: string,
): Promise<ExchangeResult> {
  const key = `${provider}:${state}:${code}`;
  const existing = exchangeCache.get(key);
  if (existing) return existing;

  const promise = http<OauthCallbackResponse>(`/auth/oauth/${provider}/callback`, {
    method: 'POST',
    auth: false,
    body: { code, state, redirect_uri: redirectUri },
  })
    .then((data) => ({ accessToken: data.accessToken }))
    .catch((error: unknown) => {
      exchangeCache.delete(key);
      throw error;
    });

  exchangeCache.set(key, promise);
  return promise;
}

function OauthCallbackContent() {
  const router = useRouter();
  const params = useSearchParams();
  const { refresh, setToken } = useSession();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const code = params.get('code');
    const state = params.get('state');
    const provider = resolveOauthProvider(params.get('provider'));

    if (!code || !state) {
      setError(
        'Faltan parámetros de seguridad OAuth. Vuelve a iniciar sesión con el proveedor.',
      );
      return;
    }

    const redirectUri = oauthCallbackRedirectUri(provider, window.location.origin);

    void (async () => {
      try {
        const data = await exchangeOauthCode(provider, code, state, redirectUri);
        if (cancelled) return;
        if (data.accessToken) setToken(data.accessToken);
        await refresh();
        if (cancelled) return;
        router.replace('/dashboard');
      } catch (err) {
        if (cancelled) return;
        setError(
          authErrorMessage(
            err,
            'No se pudo completar el inicio de sesión con el proveedor.',
          ),
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [params, refresh, router, setToken]);

  if (error) {
    return (
      <div className={styles.centerState}>
        <h1>No se pudo iniciar sesión</h1>
        <StatusBanner tone="error">{error}</StatusBanner>
        <Link href="/login" className={styles.submitLink}>
          Volver al inicio de sesión
        </Link>
      </div>
    );
  }

  return (
    <div className={styles.centerState} role="status" aria-live="polite">
      <span className={styles.spinnerDark} aria-hidden="true" />
      <h1>Completando acceso SSO…</h1>
      <p>Validando la respuesta del proveedor. No cierres esta ventana.</p>
    </div>
  );
}

function OauthFallback() {
  return (
    <div className={styles.centerState} role="status" aria-live="polite">
      <span className={styles.spinnerDark} aria-hidden="true" />
      <h1>Preparando SSO…</h1>
      <p>Cargando los parámetros de seguridad.</p>
    </div>
  );
}

export default function OauthCallbackPage() {
  return (
    <AuthShell compact>
      <Suspense fallback={<OauthFallback />}>
        <OauthCallbackContent />
      </Suspense>
    </AuthShell>
  );
}
