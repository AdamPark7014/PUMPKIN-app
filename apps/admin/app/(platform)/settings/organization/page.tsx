'use client';

import { FormEvent, useEffect, useState } from 'react';
import { inviteTeamMember, listTeam } from '@/lib/platform-api';
import { useOrgId } from '@/lib/use-org';
import platform from '../../_styles/platform.module.scss';

type Member = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  active: boolean;
};

export default function OrganizationTeamPage() {
  const orgId = useOrgId();
  const [team, setTeam] = useState<Member[]>([]);
  const [form, setForm] = useState({
    email: '',
    firstName: '',
    lastName: '',
    role: 'TAQUILLA',
    password: '',
  });

  function reload() {
    const token = localStorage.getItem('boletera_token');
    if (!token || !orgId) return;
    listTeam(token, orgId).then(setTeam).catch(() => setTeam([]));
  }

  useEffect(() => {
    reload();
  }, [orgId]);

  async function onInvite(e: FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem('boletera_token');
    if (!token || !orgId) return;
    await inviteTeamMember(token, orgId, form);
    setForm({ email: '', firstName: '', lastName: '', role: 'TAQUILLA', password: '' });
    reload();
  }

  return (
    <div>
      <header className={platform.pageHeader}>
        <div>
          <h1>Equipo y roles</h1>
          <p>RBAC multi-tenant: promotor, taquilla, scanner, venue manager</p>
        </div>
      </header>

      <section className={platform.panel}>
        <h2>Invitar miembro</h2>
        <form
          onSubmit={onInvite}
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.75rem' }}
        >
          <input
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
          <input
            placeholder="Nombre"
            value={form.firstName}
            onChange={(e) => setForm({ ...form, firstName: e.target.value })}
            required
          />
          <input
            placeholder="Apellido"
            value={form.lastName}
            onChange={(e) => setForm({ ...form, lastName: e.target.value })}
            required
          />
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="PROMOTER">Promotor</option>
            <option value="VENUE_MANAGER">Venue manager</option>
            <option value="TAQUILLA">Taquilla</option>
            <option value="SCANNER">Scanner</option>
            <option value="ADMIN">Admin</option>
          </select>
          <input
            type="password"
            placeholder="Contraseña temporal"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
          <button type="submit" className={platform.primaryBtn}>
            Invitar
          </button>
        </form>
      </section>

      <section className={platform.panel}>
        <table className={platform.table}>
          <thead>
            <tr>
              <th>Usuario</th>
              <th>Rol</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {team.map((m) => (
              <tr key={m.id}>
                <td>
                  {m.firstName} {m.lastName}
                  <br />
                  <small>{m.email}</small>
                </td>
                <td>{m.role}</td>
                <td>{m.active ? 'Activo' : 'Inactivo'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
