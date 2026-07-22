'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

const API = process.env.NEXT_PUBLIC_ADMIN_API_URL || 'http://localhost:4000/api/v1';

export default function OauthCallbackPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = params.get('code');
    const provider = (params.get('provider') || 'google') as 'google' | 'microsoft';
    if (!code) {
      setError('Falta código OAuth');
      return;
    }

    const redirectUri = `${window.location.origin}/login/oauth/callback?provider=${provider}`;
    void (async () => {
      try {
        const res = await fetch(`${API}/auth/oauth/${provider}/callback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, redirect_uri: redirectUri }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.message || 'SSO falló');
        }
        const data = (await res.json()) as {
          accessToken: string;
          user: { email: string; organizationId?: string };
        };
        localStorage.setItem('boletera_token', data.accessToken);
        if (data.user.organizationId) {
          localStorage.setItem('boletera_org_id', data.user.organizationId);
        }
        router.replace('/dashboard');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error SSO');
      }
    })();
  }, [params, router]);

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', fontFamily: 'system-ui' }}>
      <div style={{ textAlign: 'center' }}>
        <h1>{error ? 'No se pudo iniciar sesión' : 'Completando SSO…'}</h1>
        {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
        {error && (
          <a href="/login" style={{ color: '#2563eb' }}>
            Volver al login
          </a>
        )}
      </div>
    </main>
  );
}
