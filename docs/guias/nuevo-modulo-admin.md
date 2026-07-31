# Cómo añadir un módulo nuevo al Admin

Receta derivada del módulo de órdenes (`apps/admin/app/(platform)/orders/`) y del stack de queries/providers ya cableado.

**Alcance:** panel Next.js en `apps/admin` (puerto `:3001`, paquete `name`: `@boletera/admin`).

**No confundir filtros:** en `package.json` del app el nombre es `@boletera/admin`. Los scripts raíz usan Turbo `--filter=admin`; para pnpm preferí `pnpm --filter @boletera/admin …` o `pnpm --filter ./apps/admin …`.

---

## 1. Estructura de carpetas (App Router)

Patrón real de `orders/`:

```text
apps/admin/app/(platform)/<modulo>/
  page.tsx                 # pantalla cliente
  <modulo>.module.scss     # estilos locales
  [id]/page.tsx            # detalle (si aplica)
  _components/             # UI del módulo (no son rutas)
  _lib/                    # helpers, URL state, tipos, format
```

Referencia: `apps/admin/app/(platform)/orders/page.tsx`, `_components/`, `_lib/`, `orders.module.scss`.

Las carpetas que empiezan por `_` **no** generan rutas en el App Router. Úsalas para código colocalizado.

El grupo `(platform)` aplica el layout de plataforma (shell + nav):

```1:6:apps/admin/app/(platform)/layout.tsx
'use client';

import { PlatformShell } from '@/components/shell';

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return <PlatformShell>{children}</PlatformShell>;
}
```

---

## 2. Registrar el ítem de menú

El layout **no** lista rutas. La navegación vive en:

`apps/admin/components/shell/nav-config.ts` → `NAV_GROUPS`

Ejemplo real (órdenes):

```65:71:apps/admin/components/shell/nav-config.ts
      {
        id: 'orders',
        href: '/orders',
        label: 'Órdenes',
        icon: 'orders',
        keywords: ['pedidos', 'compras', 'tickets'],
      },
```

Pasos:

1. Añade un `NavItemDef` en el grupo adecuado (`operation`, `sales`, `intelligence`, …).
2. Elige un `icon` que exista en `apps/admin/components/shell/icons.tsx` (`IconName`).
3. Opcional: añade keywords (alimentan la command palette vía `flattenNavItems()`).
4. Si la ruta tiene segmentos nuevos en breadcrumbs, añade etiquetas en `apps/admin/components/shell/routes.ts` (`SEGMENT_LABELS`).

Sin entrada en `NAV_GROUPS`, la página existe por URL pero no aparece en el sidebar ni en la palette.

---

## 3. Providers globales (ya existen; no reinventes)

Raíz (`apps/admin/app/layout.tsx`):

- Fuentes
- `Providers` (`app/providers.tsx`)
- `ToastProvider` de `@/components/Toast/ToastProvider` (local al admin; **no** es el de `@boletera/ui`)

`Providers` monta:

```42:50:apps/admin/app/providers.tsx
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  return (
    <ErrorBoundary>
      <SessionProvider>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </SessionProvider>
    </ErrorBoundary>
  );
}
```

Defaults útiles: `staleTime` 2 min, retry solo en errores reintentables (`isRetryableError` de `lib/http.ts`), y overrides por dominio (`orders`, `analytics`, `venues`, …).

---

## 4. Query keys

Archivo: `apps/admin/lib/query-keys.ts`.

Convención jerárquica (para invalidar con prefijo):

```ts
// Patrón existente (events):
events: {
  all: scope('events'),
  lists: () => scope('events', 'list'),
  list: (filters) => scope('events', 'list', filters),
  detail: (eventId) => scope('events', 'detail', eventId),
}
```

Órdenes hoy es un poco más corto (sin `lists()`), pero sigue anclado a `all`:

```23:27:apps/admin/lib/query-keys.ts
  orders: {
    all: scope('orders'),
    list: (filters: Record<string, unknown> = {}) => scope('orders', 'list', filters),
    detail: (orderId: string) => scope('orders', 'detail', orderId),
  },
```

Al crear un dominio nuevo: añade un bloque con al menos `all` + `list`/`detail` y úsalo en queries y mutaciones.

---

## 5. Hook de dominio (`lib/queries/<dominio>.ts`)

Patrón real: `apps/admin/lib/queries/orders.ts`.

- `useQuery` / `useMutation` de `@tanstack/react-query`
- Cliente HTTP: `http` de `apps/admin/lib/http.ts` (Bearer + cookies + refresh + CSRF en mutaciones)
- Paths relativos al prefijo `NEXT_PUBLIC_ADMIN_API_URL` (default `http://localhost:4000/api/v1`)

```23:36:apps/admin/lib/queries/orders.ts
export function useOrders(filters: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: queryKeys.orders.list(filters),
    queryFn: ({ signal }) => http<OrderRow[]>('/admin/orders', { signal }),
  });
}

export function useOrder(orderId: string) {
  return useQuery({
    queryKey: queryKeys.orders.detail(orderId),
    queryFn: ({ signal }) => http<OrderDetail>(`/admin/orders/${orderId}`, { signal }),
    enabled: Boolean(orderId),
  });
}
```

Invalidación en mutaciones (y optimistic update opcional):

```63:67:apps/admin/lib/queries/orders.ts
    onSettled: (_data, _error, orderId) => {
      void client.invalidateQueries({ queryKey: queryKeys.orders.all });
      void client.invalidateQueries({ queryKey: queryKeys.orders.detail(orderId) });
      void client.invalidateQueries({ queryKey: queryKeys.overview.all });
    },
```

**Prohibido:** `fetch` crudo en páginas/hooks de dominio (pierdes refresh, CSRF y tipado de errores). Usa `http`.

Exporta el hook desde `apps/admin/lib/queries/index.ts` si el barrel ya reexporta otros dominios.

---

## 6. Página: estados de carga / error / vacío

Componentes listos:

- `apps/admin/components/QueryStates.tsx` — `QueryLoading`, `QueryError`, `QueryEmpty`, `QueryState`
- `apps/admin/components/ErrorBoundary.tsx` — ya envuelve la app en `Providers`

Ejemplo de composición con `QueryState`:

```60:78:apps/admin/components/QueryStates.tsx
export function QueryState<T>({
  data,
  isPending,
  error,
  onRetry,
  isEmpty,
  children,
}: {
  data: T | undefined;
  isPending: boolean;
  error: unknown;
  onRetry?: () => void;
  isEmpty: (value: T) => boolean;
  children: (value: T) => ReactNode;
}) {
  if (isPending) return <QueryLoading />;
  if (error) return <QueryError error={error} onRetry={onRetry} />;
  if (data === undefined || isEmpty(data)) return <QueryEmpty />;
  return children(data);
}
```

Órdenes hoy usa skeleton propio + `@boletera/ui` (`EmptyState`, `DataTable`, …) en lugar de `QueryState`; ambos enfoques son válidos. Organization usa `QueryLoading` / `QueryError` directamente.

---

## 7. Prefetch al navegar

`apps/admin/lib/prefetch.ts` mapea `href` → `prefetchQuery`.

Para un módulo nuevo, añade un `else if (href === '/tu-ruta')` con la misma `queryKey`/`queryFn` que tu hook.

El shell puede usar `usePrefetchNavigation().linkProps(href)` en hover/focus.

Hoy solo están cableados: `/dashboard`, `/events`, `/calendar`, `/orders`, `/maps`, `/settings/organization`.

---

## 8. Tiempo real (opcional)

`apps/admin/lib/use-realtime.ts`:

- SSE vía `EventSource`
- Escribe en la caché de React Query con `setQueryData`
- Helper concreto: `useRealtimeDashboardUpdates` → stream en `/reports/dashboard/realtime/:organizationId/stream`

Solo úsalo si el backend ya expone un stream para tu dominio.

---

## 9. Sesión y organización activa

```ts
import { useSession } from '@/lib/use-session';

const { organizationId, role, can, status } = useSession();
```

- `useOrgId()` en `use-org.ts` está **deprecated**; usa `useSession().organizationId`.
- Tokens: `getTokenStorage()` apunta a `cookieTokenStorage` (memoria + fallback legacy de `localStorage`). No introduzcas un nuevo `localStorage.setItem('boletera_token', …)`. Ver [SECURITY-MIGRATION.md](../../apps/api/src/modules/auth/SECURITY-MIGRATION.md).

---

## 10. UI del módulo

Órdenes importa del barrel `@boletera/ui` **y** a veces de paths profundos (`@boletera/ui/src/components/...`). Preferí el barrel (`packages/ui/src/index.ts`) cuando el símbolo esté exportado.

Estilos: `<modulo>.module.scss`. Tokens: ver [design-system.md](./design-system.md). Tema global ya se carga en `apps/admin/app/globals.scss` con `@use` de `theme.scss`.

---

## Checklist de PR

- [ ] Carpeta bajo `app/(platform)/<modulo>/` con `page.tsx` + module SCSS
- [ ] Entrada en `nav-config.ts` (+ `routes.ts` si hace falta breadcrumb)
- [ ] Bloque en `query-keys.ts` con `all` / list / detail
- [ ] Hook en `lib/queries/<dominio>.ts` usando `http` + invalidación en mutaciones
- [ ] Estados pending/error/empty (QueryStates, skeleton o EmptyState)
- [ ] Prefetch en `prefetch.ts` si la ruta es de primer nivel en el nav
- [ ] Sin `fetch` crudo; sin persistir tokens en `localStorage` nuevos
- [ ] `pnpm --filter @boletera/admin check-types` (o el filtro Turbo que use CI)
- [ ] Lint / sin secretos en el diff
- [ ] Si toca API: seguir [nuevo-endpoint-api.md](./nuevo-endpoint-api.md) y [consultas-multi-tenant.md](./consultas-multi-tenant.md)

## Enlaces

- [Índice de guías](./README.md)
- [Arquitectura](../arquitectura.md)
- [Design system](./design-system.md)
- [SECURITY-MIGRATION](../../apps/api/src/modules/auth/SECURITY-MIGRATION.md)
