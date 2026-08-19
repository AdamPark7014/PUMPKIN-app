'use client';

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  clearSession,
  decodeSessionToken,
  getTokenStorage,
  type SessionSnapshot,
  type SessionUser,
} from './session';
import { HttpError, http, logoutSession, revokeAllSessions } from './http';

export type Permission = string;

export type SessionContextValue = {
  status: 'loading' | 'authenticated' | 'unauthenticated';
  token: string | null;
  user: SessionUser | null;
  organizationId: string | null;
  role: string | null;
  can(permission: Permission): boolean;
  setToken(token: string): void;
  signOut(): Promise<void>;
  revokeAll(): Promise<void>;
  refresh(): Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

const ADMIN_ROLES = new Set(['ADMIN', 'SUPER_ADMIN', 'OWNER']);

type MeResponse = {
  id: string;
  email: string;
  organizationId: string | null;
  role: string;
  permissions?: readonly string[];
};

function sessionFromUser(user: MeResponse): SessionSnapshot {
  const token = getTokenStorage().getToken();
  const tokenSession = token ? decodeSessionToken(token) : null;
  return {
    token,
    expiresAt: tokenSession?.expiresAt ?? null,
    expired: false,
    user: {
      id: user.id,
      email: user.email,
      organizationId: user.organizationId,
      role: user.role,
      permissions: user.permissions ?? [],
    },
  };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionSnapshot | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const refreshRequestId = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++refreshRequestId.current;
    try {
      const user = await http<MeResponse>('/auth/me');
      if (requestId !== refreshRequestId.current) return;
      if (user.organizationId) {
        getTokenStorage().setOrganizationId(user.organizationId);
      }
      setSession(sessionFromUser(user));
    } catch (error) {
      if (requestId === refreshRequestId.current) {
        // Sólo un rechazo de credenciales (401/403) cierra la sesión. Un 429,
        // un 5xx o un corte de red NO significan "no autenticado": en ese caso
        // se conserva la sesión actual y se reintenta en el siguiente ciclo.
        // Antes cualquier fallo expulsaba al usuario — en un evento con red
        // inestable eso sacaba a cajeros y admins sin motivo.
        const status = error instanceof HttpError ? error.status : null;
        if (status === 401 || status === 403) {
          clearSession();
          setSession(null);
        }
      }
      throw error;
    } finally {
      if (requestId === refreshRequestId.current) setHydrated(true);
    }
  }, []);

  useEffect(() => {
    void refresh().catch(() => undefined);
    const onStorage = () => {
      void refresh().catch(() => undefined);
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('storage', onStorage);
    };
  }, [refresh]);

  useEffect(() => {
    if (session?.expiresAt === null || session?.expiresAt === undefined) return;
    const timer = window.setTimeout(
      () => void refresh().catch(() => undefined),
      Math.max(0, session.expiresAt - Date.now()) + 50,
    );
    return () => window.clearTimeout(timer);
  }, [refresh, session?.expiresAt]);

  const setToken = useCallback((token: string) => {
    const decoded = decodeSessionToken(token);
    if (!decoded || decoded.expired) {
      clearSession();
      setSession(null);
      return;
    }
    getTokenStorage().setToken(token);
    if (decoded.user.organizationId) {
      getTokenStorage().setOrganizationId(decoded.user.organizationId);
    }
    setSession(decoded);
  }, []);

  const signOut = useCallback(async () => {
    refreshRequestId.current += 1;
    try {
      await logoutSession();
    } finally {
      setSession(null);
    }
  }, []);

  const revokeAll = useCallback(async () => {
    refreshRequestId.current += 1;
    try {
      await revokeAllSessions();
    } finally {
      setSession(null);
    }
  }, []);

  const can = useCallback(
    (permission: Permission) => {
      if (!session) return false;
      if (ADMIN_ROLES.has(session.user.role.toUpperCase())) return true;
      return (
        session.user.permissions.includes(permission) ||
        session.user.permissions.includes('*')
      );
    },
    [session],
  );

  const value = useMemo<SessionContextValue>(
    () => ({
      status: !hydrated
        ? 'loading'
        : session
          ? 'authenticated'
          : 'unauthenticated',
      token: session?.token ?? null,
      user: session?.user ?? null,
      organizationId: session?.user.organizationId ?? null,
      role: session?.user.role ?? null,
      can,
      setToken,
      signOut,
      revokeAll,
      refresh,
    }),
    [can, hydrated, refresh, revokeAll, session, setToken, signOut],
  );

  return createElement(SessionContext.Provider, { value }, children);
}

export function useSession(): SessionContextValue {
  const session = useContext(SessionContext);
  if (!session) {
    throw new Error('useSession debe usarse dentro de SessionProvider');
  }
  return session;
}
