'use client';

import { useSession } from './use-session';

/** @deprecated Usa `useSession().organizationId`. */
export function useOrgId() {
  return useSession().organizationId;
}
