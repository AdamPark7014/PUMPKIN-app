import type { IconName } from './icons';

export type NavItemId = string;

export type NavItemDef = {
  id: NavItemId;
  href: string;
  label: string;
  icon: IconName;
  keywords?: readonly string[];
  /** Matching for nested routes. Defaults to href prefix with special cases. */
  match?: 'exact' | 'prefix' | 'events' | 'reports';
};

export type NavGroupDef = {
  id: string;
  label: string;
  items: readonly NavItemDef[];
  /** Venues subsection rendered after items when true. */
  showVenues?: boolean;
  defaultCollapsed?: boolean;
};

/**
 * Catálogo de navegación de Pumpkin Zone.
 *
 * Evento único, admisión general, un solo precio: fuera mapas, series,
 * reventa, membresías, CRM, pricing dinámico y demás módulos de plataforma.
 * Queda lo que la operación usa: vender, cobrar, escanear, reportar.
 */
export const NAV_GROUPS: readonly NavGroupDef[] = [
  {
    id: 'operation',
    label: 'Operación',
    items: [
      {
        id: 'dashboard',
        href: '/dashboard',
        label: 'Inicio',
        icon: 'home',
        keywords: ['dashboard', 'panel', 'resumen'],
        match: 'exact',
      },
      {
        id: 'events',
        href: '/events',
        label: 'Evento',
        icon: 'events',
        keywords: ['pumpkin zone', 'fechas', 'boletos', 'inventario'],
        match: 'events',
      },
      {
        id: 'orders',
        href: '/orders',
        label: 'Órdenes',
        icon: 'orders',
        keywords: ['ventas', 'compras', 'boletos', 'reembolso'],
        match: 'prefix',
      },
      {
        id: 'scanner',
        href: '/scanner',
        label: 'Escáner',
        icon: 'scanner',
        keywords: ['acceso', 'puerta', 'qr', 'check-in'],
        match: 'prefix',
      },
    ],
  },
  {
    id: 'sales',
    label: 'Ventas y taquillas',
    items: [
      {
        id: 'channels',
        href: '/channels',
        label: 'Canales',
        icon: 'channels',
        keywords: ['web', 'taquilla', 'online', 'terminales'],
        match: 'prefix',
      },
      {
        id: 'reports',
        href: '/reports',
        label: 'Reportes',
        icon: 'reports',
        keywords: ['ventas', 'cortes', 'caja', 'taquilla', 'canal'],
        match: 'reports',
      },
      {
        id: 'payouts',
        href: '/payouts',
        label: 'Liquidaciones',
        icon: 'payouts',
        keywords: ['pagos', 'promotor', 'depósito'],
        match: 'prefix',
      },
    ],
  },
  {
    id: 'team',
    label: 'Equipo',
    items: [
      {
        id: 'staff',
        href: '/staff',
        label: 'Personal',
        icon: 'team',
        keywords: ['cajeros', 'escáner', 'roles'],
        match: 'prefix',
      },
      {
        id: 'organization',
        href: '/settings/organization',
        label: 'Organización',
        icon: 'user',
        keywords: ['equipo', 'invitar', 'accesos'],
        match: 'prefix',
      },
      {
        id: 'audit',
        href: '/audit',
        label: 'Auditoría',
        icon: 'audit',
        keywords: ['bitácora', 'quién hizo qué'],
        match: 'prefix',
      },
    ],
  },
  {
    id: 'settings',
    label: 'Configuración',
    defaultCollapsed: true,
    items: [
      {
        id: 'branding',
        href: '/settings/branding',
        label: 'Marca',
        icon: 'branding',
        keywords: ['logo', 'colores', 'dominio'],
        match: 'prefix',
      },
      {
        id: 'payments',
        href: '/settings/payments',
        label: 'Pagos',
        icon: 'payments',
        keywords: ['mercado pago', 'pasarela', 'cobros'],
        match: 'prefix',
      },
    ],
  },
];

export function flattenNavItems(): NavItemDef[] {
  return NAV_GROUPS.flatMap((group) => [...group.items]);
}

export function isNavItemActive(pathname: string, item: NavItemDef): boolean {
  const match = item.match ?? 'prefix';
  if (match === 'exact') return pathname === item.href;
  if (match === 'events') {
    if (pathname === '/events') return true;
    if (!pathname.startsWith('/events/')) return false;
    return !pathname.startsWith('/events/series');
  }
  if (match === 'reports') {
    if (pathname === '/reports') return true;
    if (!pathname.startsWith('/reports/')) return false;
    return !pathname.startsWith('/reports/egress');
  }
  if (pathname === item.href) return true;
  return pathname.startsWith(`${item.href}/`);
}

export function roleLabel(role: string | null | undefined): string {
  if (!role) return 'Usuario';
  switch (role.toUpperCase()) {
    case 'SUPER_ADMIN':
      return 'Super admin';
    case 'ADMIN':
      return 'Administrador';
    case 'OWNER':
      return 'Propietario';
    case 'MANAGER':
      return 'Gerente';
    case 'STAFF':
      return 'Staff';
    case 'SCANNER':
      return 'Escáner';
    default:
      return role;
  }
}
