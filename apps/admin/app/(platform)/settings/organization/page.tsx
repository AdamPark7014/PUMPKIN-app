'use client';

import { Suspense, useDeferredValue, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ActivityFeed,
  Avatar,
  Badge,
  Button,
  DataTable,
  DonutChart,
  EmptyState,
  FilterBar,
  Input,
  KpiCard,
  PageHeader,
  Section,
  SegmentedControl,
  StatusDot,
  Tabs,
  type DataTableColumn,
  type FilterDefinition,
  type FilterSelection,
} from '@boletera/ui';
import { QueryError, QueryLoading } from '@/components/QueryStates';
import { useToast } from '@/components/Toast/ToastProvider';
import { http } from '@/lib/http';
import { queryKeys } from '@/lib/query-keys';
import { useAuditLog } from '@/lib/queries/audit';
import {
  useInviteTeamMember,
  useOrganization,
  useSaasCapabilities,
  useTeam,
  type TeamMember,
} from '@/lib/queries/organization';
import { useSession } from '@/lib/use-session';
import { InviteMemberModal, type InvitePayload } from './_components/InviteMemberModal';
import { toActivityItems } from './_lib/audit';
import { formatCommission, formatCount, relativeLogin } from './_lib/format';
import { roleTone, TEAM_ROLES } from './_lib/roles';
import {
  computeTeamKpis,
  filterTeam,
  roleSlices,
  type MemberStatusFilter,
} from './_lib/team';
import {
  isOrganizationProfile,
  profileFromOrg,
  type OrganizationProfile,
  type OrgTab,
  type ProfileForm,
} from './_lib/types';
import { useOrgUrlState } from './_lib/use-org-url-state';
import styles from './organization.module.scss';

function OrganizationCockpit() {
  const { organizationId } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const url = useOrgUrlState();
  const deferredQ = useDeferredValue(url.q);

  const orgQuery = useOrganization(organizationId);
  const capsQuery = useSaasCapabilities(organizationId);
  const teamQuery = useTeam(organizationId);
  const auditQuery = useAuditLog(organizationId, 50);
  const inviteMember = useInviteTeamMember(organizationId ?? '');

  const [now, setNow] = useState(() => Date.now());
  const [profile, setProfile] = useState<ProfileForm | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const org = isOrganizationProfile(orgQuery.data) ? orgQuery.data : null;

  useEffect(() => {
    if (!org) return;
    setProfile(profileFromOrg(org));
  }, [org]);

  const updateOrg = useMutation({
    mutationFn: (body: Partial<ProfileForm>) =>
      http<OrganizationProfile>(`/organization/${organizationId}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.organization.detail(organizationId ?? ''), data);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.organization.capabilities(organizationId ?? ''),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.audit.log(organizationId ?? '', 50),
      });
    },
  });

  const updateMember = useMutation({
    mutationFn: ({
      userId,
      body,
    }: {
      userId: string;
      body: { role?: string; active?: boolean };
    }) =>
      http<TeamMember>(`/organization/${organizationId}/team/${userId}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.organization.team(organizationId ?? ''),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.audit.log(organizationId ?? '', 50),
      });
    },
  });

  const team = teamQuery.data ?? [];
  const caps = capsQuery.data;
  const teamKpis = useMemo(() => computeTeamKpis(team), [team]);
  const slices = useMemo(() => roleSlices(team), [team]);
  const activityItems = useMemo(
    () => toActivityItems(auditQuery.data ?? []),
    [auditQuery.data],
  );

  const filteredTeam = useMemo(
    () =>
      filterTeam(team, {
        query: deferredQ,
        status: url.status,
        role: url.role,
      }),
    [deferredQ, team, url.role, url.status],
  );

  const filterSelection = useMemo<FilterSelection>(() => {
    const next: Record<string, readonly string[]> = {};
    if (url.status !== 'all') next.status = [url.status];
    if (url.role !== 'all') next.role = [url.role];
    return next;
  }, [url.role, url.status]);

  const filterDefs = useMemo<FilterDefinition[]>(
    () => [
      {
        id: 'status',
        label: 'Estado',
        multiple: false,
        options: [
          { value: 'active', label: 'Activos' },
          { value: 'inactive', label: 'Inactivos' },
        ],
      },
      {
        id: 'role',
        label: 'Rol',
        multiple: false,
        options: TEAM_ROLES.map((role) => ({ value: role.value, label: role.label })),
      },
    ],
    [],
  );

  async function onSaveProfile(event: FormEvent) {
    event.preventDefault();
    if (!profile || !organizationId) return;
    try {
      await updateOrg.mutateAsync({
        name: profile.name.trim(),
        description: profile.description.trim() || undefined,
        website: profile.website.trim() || undefined,
        email: profile.email.trim() || undefined,
        phone: profile.phone.trim() || undefined,
        allowResale: profile.allowResale,
      });
      toast.success('Perfil actualizado');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar');
    }
  }

  async function onInvite(payload: InvitePayload) {
    if (!organizationId) return;
    await inviteMember.mutateAsync({
      email: payload.email.trim(),
      firstName: payload.firstName.trim(),
      lastName: payload.lastName.trim(),
      role: payload.role,
      password: payload.password,
    });
    toast.success('Miembro invitado');
    setInviteOpen(false);
    void auditQuery.refetch();
  }

  async function onRoleChange(member: TeamMember, role: string) {
    if (role === member.role) return;
    setBusyUserId(member.id);
    try {
      await updateMember.mutateAsync({ userId: member.id, body: { role } });
      toast.success(`Rol de ${member.firstName} actualizado`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cambiar el rol');
    } finally {
      setBusyUserId(null);
    }
  }

  async function onToggleActive(member: TeamMember) {
    setBusyUserId(member.id);
    try {
      await updateMember.mutateAsync({
        userId: member.id,
        body: { active: !member.active },
      });
      toast.success(member.active ? 'Miembro desactivado' : 'Miembro reactivado');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo actualizar');
    } finally {
      setBusyUserId(null);
    }
  }

  const teamColumns: DataTableColumn<TeamMember>[] = [
    {
      key: 'name',
      header: 'Miembro',
      width: 240,
      sortValue: (row) => `${row.lastName} ${row.firstName}`,
      render: (row) => (
        <div className={styles.memberCell}>
          <Avatar name={`${row.firstName} ${row.lastName}`} size="sm" decorative />
          <div className={styles.memberMeta}>
            <strong>
              {row.firstName} {row.lastName}
            </strong>
            <span>{row.email}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Rol',
      width: 170,
      sortValue: (row) => row.role,
      render: (row) => (
        <select
          className={styles.roleSelect}
          aria-label={`Rol de ${row.firstName} ${row.lastName}`}
          value={row.role}
          disabled={busyUserId === row.id}
          onChange={(e) => void onRoleChange(row, e.target.value)}
        >
          {TEAM_ROLES.map((role) => (
            <option key={role.value} value={role.value}>
              {role.label}
            </option>
          ))}
        </select>
      ),
    },
    {
      key: 'active',
      header: 'Estado',
      width: 110,
      sortValue: (row) => (row.active ? 1 : 0),
      render: (row) => (
        <Badge tone={row.active ? 'success' : 'neutral'} variant="soft" size="sm" dot>
          {row.active ? 'Activo' : 'Inactivo'}
        </Badge>
      ),
    },
    {
      key: 'lastLogin',
      header: 'Último acceso',
      width: 140,
      sortValue: (row) => (row.lastLogin ? new Date(row.lastLogin).getTime() : 0),
      render: (row) => (
        <span className={styles.muted}>{relativeLogin(row.lastLogin, now)}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: 120,
      resizable: false,
      render: (row) => (
        <div className={styles.rowActions}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busyUserId === row.id}
            onClick={() => void onToggleActive(row)}
          >
            {row.active ? 'Desactivar' : 'Activar'}
          </Button>
        </div>
      ),
    },
  ];

  if (!organizationId) {
    return (
      <div className={styles.page}>
        <EmptyState
          title="Sin organización"
          description="Inicia sesión con una cuenta vinculada a una organización."
          illustration="error"
        />
      </div>
    );
  }

  const verified = Boolean(org?.verified || caps?.organization.verified);

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Configuración"
        title="Organización"
        description="Perfil del tenant, equipo, roles y auditoría contextual."
        actions={
          url.tab === 'team' ? (
            <Button type="button" onClick={() => setInviteOpen(true)}>
              Invitar miembro
            </Button>
          ) : null
        }
      >
        <div className={styles.tabsSlot}>
          <Tabs
            label="Secciones de organización"
            value={url.tab}
            onValueChange={(id) => url.setTab(id as OrgTab)}
            items={[
              { id: 'profile', label: 'Perfil' },
              { id: 'team', label: 'Equipo', badge: teamKpis.total || undefined },
              { id: 'roles', label: 'Roles' },
              { id: 'audit', label: 'Auditoría' },
            ]}
          />
        </div>
      </PageHeader>

      <Section columns={4} gap="sm" aria-label="Resumen de organización">
        <KpiCard
          label="Miembros activos"
          value={formatCount(teamKpis.active)}
          hint={`${formatCount(teamKpis.total)} en el equipo`}
          loading={teamQuery.isPending}
          tone="success"
        />
        <KpiCard
          label="Eventos"
          value={formatCount(caps?.metrics.events ?? org?._count?.events ?? 0)}
          loading={capsQuery.isPending || orgQuery.isPending}
        />
        <KpiCard
          label="API keys"
          value={formatCount(caps?.metrics.apiKeys ?? 0)}
          loading={capsQuery.isPending}
          tone="info"
        />
        <KpiCard
          label="Verificación"
          value={verified ? 'Verificada' : 'Pendiente'}
          loading={orgQuery.isPending}
          tone={verified ? 'success' : 'warning'}
          hint={caps?.organization.slug ?? org?.slug}
        />
      </Section>

      {url.tab === 'profile' ? (
        orgQuery.isPending && !org ? (
          <QueryLoading label="Cargando perfil…" />
        ) : orgQuery.error ? (
          <QueryError error={orgQuery.error} onRetry={() => void orgQuery.refetch()} />
        ) : profile ? (
          <div className={styles.profileGrid}>
            <form className={`${styles.card} ${styles.formGrid}`} onSubmit={(e) => void onSaveProfile(e)}>
              <div className={styles.cardHead}>
                <div>
                  <h2>Perfil del tenant</h2>
                  <p className={styles.verifiedPill}>
                    <StatusDot
                      tone={verified ? 'success' : 'warning'}
                      pulse={verified}
                      aria-hidden
                    />
                    {org?.slug}
                    {verified ? ' · Verificada' : ' · Sin verificar'}
                  </p>
                </div>
                <Button type="submit" loading={updateOrg.isPending} loadingLabel="Guardando…">
                  Guardar
                </Button>
              </div>
              <Input
                label="Nombre"
                requiredMark
                required
                value={profile.name}
                onChange={(e) => setProfile((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
              />
              <Input
                label="Descripción"
                value={profile.description}
                onChange={(e) =>
                  setProfile((prev) => (prev ? { ...prev, description: e.target.value } : prev))
                }
              />
              <div className={styles.fieldRow}>
                <Input
                  label="Sitio web"
                  type="url"
                  value={profile.website}
                  onChange={(e) =>
                    setProfile((prev) => (prev ? { ...prev, website: e.target.value } : prev))
                  }
                />
                <Input
                  label="Email de contacto"
                  type="email"
                  value={profile.email}
                  onChange={(e) =>
                    setProfile((prev) => (prev ? { ...prev, email: e.target.value } : prev))
                  }
                />
              </div>
              <div className={styles.fieldRow}>
                <Input
                  label="Teléfono"
                  value={profile.phone}
                  onChange={(e) =>
                    setProfile((prev) => (prev ? { ...prev, phone: e.target.value } : prev))
                  }
                />
                <label className={styles.checkRow}>
                  <input
                    type="checkbox"
                    checked={profile.allowResale}
                    onChange={(e) =>
                      setProfile((prev) =>
                        prev ? { ...prev, allowResale: e.target.checked } : prev,
                      )
                    }
                  />
                  Permitir reventa oficial
                </label>
              </div>
            </form>

            <aside className={styles.card}>
              <div className={styles.cardHead}>
                <div>
                  <h2>Capacidad operativa</h2>
                  <p>Métricas del tenant</p>
                </div>
              </div>
              <ul className={styles.statsList}>
                <li className={styles.statRow}>
                  <span>Venues</span>
                  <strong>{formatCount(org?._count?.venues ?? 0)}</strong>
                </li>
                <li className={styles.statRow}>
                  <span>Órdenes</span>
                  <strong>{formatCount(org?._count?.orders ?? 0)}</strong>
                </li>
                <li className={styles.statRow}>
                  <span>Terminales POS</span>
                  <strong>{formatCount(caps?.metrics.terminals ?? 0)}</strong>
                </li>
                <li className={styles.statRow}>
                  <span>Waitlist pendiente</span>
                  <strong>{formatCount(caps?.metrics.waitlistPending ?? 0)}</strong>
                </li>
                <li className={styles.statRow}>
                  <span>Comisión</span>
                  <strong>{org ? formatCommission(org.commissionRate) : '—'}</strong>
                </li>
              </ul>
            </aside>
          </div>
        ) : (
          <EmptyState title="Organización no encontrada" illustration="error" />
        )
      ) : null}

      {url.tab === 'team' ? (
        teamQuery.error ? (
          <QueryError error={teamQuery.error} onRetry={() => void teamQuery.refetch()} />
        ) : (
          <div className={styles.layout}>
            <Section
              title="Equipo"
              description="Invitaciones, roles y estado de acceso."
              actions={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void teamQuery.refetch()}
                >
                  Actualizar
                </Button>
              }
            >
              <div className={styles.filters}>
                <FilterBar
                  filters={filterDefs}
                  value={filterSelection}
                  onChange={(next) => {
                    const status = (next.status?.[0] as MemberStatusFilter | undefined) ?? 'all';
                    const role = next.role?.[0] ?? 'all';
                    url.setStatus(status);
                    url.setRole(role);
                  }}
                  search={{
                    value: url.q,
                    onChange: url.setSearch,
                    placeholder: 'Buscar por nombre, email o rol',
                  }}
                >
                  <SegmentedControl
                    label="Filtro rápido de estado"
                    size="sm"
                    value={url.status}
                    onValueChange={(value) => url.setStatus(value)}
                    options={[
                      { value: 'all', label: 'Todos' },
                      { value: 'active', label: 'Activos' },
                      { value: 'inactive', label: 'Inactivos' },
                    ]}
                  />
                </FilterBar>
              </div>

              <div className={styles.tableMeta}>
                <span className={styles.muted}>
                  {formatCount(filteredTeam.length)} de {formatCount(team.length)} miembros
                  {teamKpis.neverLoggedIn > 0
                    ? ` · ${formatCount(teamKpis.neverLoggedIn)} sin primer acceso`
                    : ''}
                </span>
              </div>

              <DataTable
                label="Miembros del equipo"
                columns={teamColumns}
                data={filteredTeam}
                rowKey={(row) => row.id}
                loading={teamQuery.isPending}
                maxHeight={460}
                empty={
                  <EmptyState
                    title={team.length === 0 ? 'Sin miembros' : 'Sin resultados'}
                    description={
                      team.length === 0
                        ? 'Invita a promotores, taquilla o scanners.'
                        : 'Ajusta la búsqueda o limpia los filtros.'
                    }
                    illustration={team.length === 0 ? 'inbox' : 'search'}
                    action={
                      team.length === 0 ? (
                        <Button type="button" onClick={() => setInviteOpen(true)}>
                          Invitar
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={url.clearTeamFilters}
                        >
                          Limpiar filtros
                        </Button>
                      )
                    }
                  />
                }
              />
            </Section>

            <aside className={styles.card}>
              <div className={styles.cardHead}>
                <div>
                  <h2>Distribución por rol</h2>
                  <p>Composición actual del equipo</p>
                </div>
              </div>
              {slices.length === 0 ? (
                <EmptyState
                  title="Sin roles asignados"
                  description="Invita al primer miembro para ver la mezcla."
                  illustration="chart"
                  size="sm"
                />
              ) : (
                <DonutChart
                  label="Distribución del equipo por rol"
                  slices={slices}
                  height={200}
                  centerLabel="Miembros"
                  formatValue={(value) => formatCount(value)}
                />
              )}
              <ul className={styles.statsList}>
                {teamKpis.byRole.map((row) => (
                  <li key={row.role} className={styles.statRow}>
                    <span>
                      <Badge tone={roleTone(row.role)} variant="soft" size="sm">
                        {row.label}
                      </Badge>
                    </span>
                    <strong>{formatCount(row.count)}</strong>
                  </li>
                ))}
              </ul>
            </aside>
          </div>
        )
      ) : null}

      {url.tab === 'roles' ? (
        <div className={styles.layout}>
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <div>
                <h2>Matriz de permisos</h2>
                <p>Capacidades por rol RBAC multi-tenant</p>
              </div>
            </div>
            <div className={styles.matrix}>
              {TEAM_ROLES.map((role) => (
                <div key={role.value} className={styles.matrixRow}>
                  <div className={styles.matrixRole}>
                    <Badge tone={role.tone} variant="soft" size="sm" dot>
                      {role.label}
                    </Badge>
                  </div>
                  <div className={styles.permChips}>
                    {role.permissions.map((perm) => (
                      <Badge key={perm} tone="neutral" variant="outline" size="sm">
                        {perm}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <aside className={styles.card}>
            <div className={styles.cardHead}>
              <div>
                <h2>Módulos habilitados</h2>
                <p>Según capacidades SaaS</p>
              </div>
            </div>
            {capsQuery.isPending ? (
              <QueryLoading label="Cargando módulos…" />
            ) : capsQuery.error ? (
              <QueryError error={capsQuery.error} onRetry={() => void capsQuery.refetch()} />
            ) : (
              <div className={styles.modules}>
                {Object.entries(caps?.modules ?? {}).map(([key, enabled]) => (
                  <div key={key} className={styles.moduleChip}>
                    <span>{key}</span>
                    <Badge tone={enabled ? 'success' : 'neutral'} variant="soft" size="sm" dot>
                      {enabled ? 'On' : 'Off'}
                    </Badge>
                  </div>
                ))}
                {Object.keys(caps?.modules ?? {}).length === 0 ? (
                  <p className={styles.muted}>Sin módulos reportados por el backend.</p>
                ) : null}
              </div>
            )}
          </aside>
        </div>
      ) : null}

      {url.tab === 'audit' ? (
        <Section
          title="Auditoría contextual"
          description="Cambios de organización, equipo e integraciones."
          actions={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void auditQuery.refetch()}
            >
              Actualizar
            </Button>
          }
        >
          {auditQuery.error ? (
            <QueryError error={auditQuery.error} onRetry={() => void auditQuery.refetch()} />
          ) : (
            <ActivityFeed
              items={activityItems}
              loading={auditQuery.isPending}
              label="Auditoría de organización"
              empty={
                <EmptyState
                  title="Sin eventos de auditoría"
                  description="Las invitaciones y cambios de perfil aparecerán aquí."
                  illustration="inbox"
                  size="sm"
                />
              }
            />
          )}
        </Section>
      ) : null}

      <InviteMemberModal
        open={inviteOpen}
        busy={inviteMember.isPending}
        onClose={() => setInviteOpen(false)}
        onSubmit={onInvite}
      />
    </div>
  );
}

export default function OrganizationPage() {
  return (
    <Suspense
      fallback={
        <div className={styles.page} role="status" aria-live="polite">
          Cargando organización…
        </div>
      }
    >
      <OrganizationCockpit />
    </Suspense>
  );
}
