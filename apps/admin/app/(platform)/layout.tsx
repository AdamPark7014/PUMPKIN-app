'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import styles from './shell.module.scss';

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  badge?: string;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const Icon = ({ d }: { d: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d={d} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const navGroups: NavGroup[] = [
  {
    label: 'Operación',
    items: [
      {
        href: '/dashboard',
        label: 'Command Center',
        icon: <Icon d="M3 12 12 3l9 9M5 10v10h14V10" />,
      },
      {
        href: '/events',
        label: 'Eventos',
        icon: <Icon d="M4 7h16v13H4zM4 7l2-3h12l2 3M9 12h6" />,
      },
      {
        href: '/calendar',
        label: 'Calendario',
        icon: <Icon d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" />,
      },
      {
        href: '/orders',
        label: 'Órdenes',
        icon: <Icon d="M6 4h12l2 6-7 10-7-10z M3 10h18" />,
      },
    ],
  },
  {
    label: 'Distribución',
    items: [
      {
        href: '/channels',
        label: 'Canales',
        icon: <Icon d="M4 12h4l3-7 4 14 3-7h2" />,
      },
      {
        href: '/campaigns',
        label: 'Campañas',
        icon: <Icon d="M3 11l18-7-7 18-2-7-9-4z" />,
      },
      {
        href: '/venues',
        label: 'Venues & Mapas',
        icon: <Icon d="M12 21s-7-7-7-12a7 7 0 0 1 14 0c0 5-7 12-7 12z M12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />,
      },
      {
        href: '/resale',
        label: 'Reventa',
        icon: <Icon d="M7 7h13l-1.5 9H7zM7 7L6 4H3 M9 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM18 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" />,
      },
    ],
  },
  {
    label: 'Insights',
    items: [
      {
        href: '/analytics',
        label: 'Analytics',
        icon: <Icon d="M3 21V3 M3 21h18 M7 17v-5 M11 17v-9 M15 17v-3 M19 17v-7" />,
      },
      {
        href: '/reports',
        label: 'Reportes',
        icon: <Icon d="M6 3h9l5 5v13H6zM14 3v6h6" />,
      },
      {
        href: '/payouts',
        label: 'Liquidaciones',
        icon: <Icon d="M2 8h20v10H2z M6 12h2 M14 12h4" />,
      },
      {
        href: '/fraud',
        label: 'Antifraude',
        icon: <Icon d="M12 3l8 4v5c0 5-4 8-8 9-4-1-8-4-8-9V7l8-4z M9 12l2 2 4-4" />,
      },
    ],
  },
  {
    label: 'Operativa',
    items: [
      {
        href: '/scanner',
        label: 'Scanner',
        icon: <Icon d="M3 7V5a2 2 0 0 1 2-2h2 M17 3h2a2 2 0 0 1 2 2v2 M21 17v2a2 2 0 0 1-2 2h-2 M7 21H5a2 2 0 0 1-2-2v-2 M3 12h18" />,
      },
      {
        href: '/settings/branding',
        label: 'Branding',
        icon: <Icon d="M12 3a9 9 0 1 0 9 9c0-1-3 0-5-2s-1-5-2-6-1-1-2-1z M7 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z M16 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2z M16 16a1 1 0 1 0 0-2 1 1 0 0 0 0 2z M10 17a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" />,
      },
    ],
  },
  {
    label: 'Plataforma SaaS',
    items: [
      {
        href: '/platform',
        label: 'Capabilities',
        icon: <Icon d="M4 6h16v12H4z M8 10h8 M8 14h5 M12 2v4 M12 18v4" />,
      },
      {
        href: '/waitlist',
        label: 'Lista de espera',
        icon: <Icon d="M4 6h16v12H4z M8 10h8 M8 14h5 M12 2v4" />,
      },
      {
        href: '/partners',
        label: 'Partners & API',
        icon: <Icon d="M12 3l8 4v5c0 5-4 8-8 9-4-1-8-4-8-9V7l8-4z M9 12h6 M12 9v6" />,
      },
      {
        href: '/billing/cfdi',
        label: 'CFDI 4.0',
        icon: <Icon d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M9 15h6 M9 11h6" />,
      },
      {
        href: '/season',
        label: 'Abonos',
        icon: <Icon d="M4 4h16v4H4z M4 10h10v10H4z M16 10h4v10h-4z" />,
      },
      {
        href: '/settings/organization',
        label: 'Equipo',
        icon: <Icon d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75" />,
      },
      {
        href: '/audit',
        label: 'Auditoría',
        icon: <Icon d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8" />,
      },
    ],
  },
];

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [userEmail, setUserEmail] = useState<string>('');

  useEffect(() => {
    const token = localStorage.getItem('boletera_token');
    if (!token) router.replace('/login');
    try {
      const payload = JSON.parse(atob(token?.split('.')[1] ?? ''));
      setUserEmail(payload?.email ?? '');
    } catch {
      /* ignore */
    }
  }, [router]);

  const breadcrumb = pathname.split('/').filter(Boolean);

  return (
    <div className={styles.shell}>
      <aside className={`${styles.sidebar} ${open ? styles.sidebarOpen : ''}`}>
        <div className={styles.sidebarTop}>
          <div className={styles.logoBlock}>
            <div className={styles.logoMark}>
              <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
                <rect width="32" height="32" rx="9" fill="#fafafa" />
                <path d="M9 11h14M9 16h14M9 21h9" stroke="#0a0a0a" strokeWidth="2.4" strokeLinecap="round" />
                <circle cx="22" cy="21" r="2.5" fill="#0a0a0a" />
              </svg>
            </div>
            <div>
              <p className={styles.logoText}>BOLETERA</p>
              <p className={styles.logoSub}>Admin Console</p>
            </div>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={() => setOpen(false)}
            aria-label="Cerrar menú"
          >
            ✕
          </button>
        </div>

        <nav className={styles.nav}>
          {navGroups.map((group) => (
            <div key={group.label} className={styles.navGroup}>
              <p className={styles.navLabel}>{group.label}</p>
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={pathname === item.href ? styles.active : styles.navItem}
                  onClick={() => setOpen(false)}
                >
                  <span className={styles.navIcon}>{item.icon}</span>
                  <span className={styles.navText}>{item.label}</span>
                  {item.badge && <span className={styles.navBadge}>{item.badge}</span>}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className={styles.sidebarFooter}>
          <div className={styles.profile}>
            <div className={styles.avatar}>{userEmail ? userEmail.charAt(0).toUpperCase() : 'A'}</div>
            <div className={styles.profileMeta}>
              <strong>{userEmail || 'Admin'}</strong>
              <span>Organizador</span>
            </div>
            <button
              type="button"
              className={styles.logoutBtn}
              aria-label="Cerrar sesión"
              onClick={() => {
                localStorage.removeItem('boletera_token');
                localStorage.removeItem('boletera_org');
                router.push('/login');
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      </aside>

      <div className={styles.content}>
        {/* Topbar */}
        <header className={styles.topbar}>
          <div className={styles.topLeft}>
            <button
              type="button"
              className={styles.menuBtn}
              onClick={() => setOpen(true)}
              aria-label="Abrir menú"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
            <div className={styles.crumbs}>
              <Link href="/dashboard">Admin</Link>
              {breadcrumb.map((c, i) => (
                <span key={c + i}>
                  <span className={styles.crumbSep}>/</span>
                  <span className={i === breadcrumb.length - 1 ? styles.crumbCurrent : ''}>
                    {c.replaceAll('-', ' ')}
                  </span>
                </span>
              ))}
            </div>
          </div>

          <div className={styles.topRight}>
            <div className={styles.statusPill}>
              <span className={styles.pillDot} />
              Sistema operando
            </div>
            <button type="button" className={styles.iconBtn} aria-label="Notificaciones">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M6 8a6 6 0 1 1 12 0v5l2 3H4l2-3V8z M10 19a2 2 0 1 0 4 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className={styles.iconBadge}>3</span>
            </button>
            <button type="button" className={styles.iconBtn} aria-label="Ayuda">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
                <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-1 .4-1 1.2-1 1.7 M12 17h.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </header>

        <main className={styles.main}>{children}</main>
      </div>

      {open && <div className={styles.overlay} onClick={() => setOpen(false)} />}
    </div>
  );
}
