'use client';

import { useEffect, useState } from 'react';
import { fetchMe } from './api';

export function useOrgId() {
  const [orgId, setOrgId] = useState<string | null>(null);

  useEffect(() => {
    const cached = localStorage.getItem('boletera_org');
    if (cached) {
      setOrgId(cached);
      return;
    }
    const token = localStorage.getItem('boletera_token');
    if (!token) return;
    fetchMe(token)
      .then((me) => {
        if (me.organizationId) {
          localStorage.setItem('boletera_org', me.organizationId);
          setOrgId(me.organizationId);
        }
      })
      .catch(() => {});
  }, []);

  return orgId;
}
