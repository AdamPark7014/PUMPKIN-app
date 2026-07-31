# Design system — `@boletera/ui`

Inventario y uso derivados de `packages/ui/src/index.ts` y los componentes bajo `packages/ui/src/components/`.

**Paquete:** `name` = `@boletera/ui`. Se consume por **código fuente** (`main`/`types` → `./src/index.ts`), no por un `dist` compilado.

---

## Consumo en el workspace

```json
// peer: react ^19, react-dom ^19
// apps/admin/package.json ya declara "@boletera/ui": "workspace:*"
```

Next debe transpilarlo (`apps/admin/next.config.ts`):

```ts
transpilePackages: ['@boletera/ui', '@boletera/venue-3d', '@boletera/venue-engine']
```

Tema global — **una vez** por app. En admin ya está en `apps/admin/app/globals.scss`:

```scss
@use '../../../packages/ui/src/styles/theme.scss';
```

El comentario del barrel lo pide así:

```ts
import '@boletera/ui/src/styles/theme.scss';
```

Tema vía `data-theme="light"|"dark"` en `<html>` (ver `theme.scss`).

---

## Tokens

| Archivo | Rol |
|---------|-----|
| `src/styles/_variables.scss` | Mapas/vars SCSS (no emite CSS) |
| `src/styles/tokens.scss` | `@forward './variables'` para CSS Modules |
| `src/styles/theme.scss` | Custom properties `--bl-*` globales |
| `src/styles/tokens.ts` | Tokens tipados para TS (`color`, `space`, `vizColor`, …) |

### Desde un `.module.scss` de admin

Hoy admin **no** tiene `sassOptions.includePaths` hacia el paquete (el comentario en analytics lo dice: solo está en `apps/web`). Usa ruta relativa:

```8:8:apps/admin/app/(platform)/analytics/analytics.module.scss
@use '../../../../../packages/ui/src/styles/variables' as *;
```

Luego `$space-5`, `$c-text-primary`, etc.

### Desde TypeScript

```ts
import { formatCurrency, vizColor, tokens } from '@boletera/ui';
// o:
import { vizColor } from '@boletera/ui/src/styles/tokens';
```

---

## Inventario de componentes exportados

Superficie pública = exports explícitos en `packages/ui/src/index.ts` (no hay `export *`).

### Primitivas

| Componente | Notas |
|------------|--------|
| `Button` | `variant`, `size`, `loading`, `iconOnly`, … |
| `Input` | |
| `SearchInput` | |
| `Card`, `CardHeader`, `CardFooter` | |
| `Badge` | `tone`, `variant`, `size`, `dot` |
| `Spinner` | |
| `StatusDot` | |
| `TrendPill` | |
| `ProgressRing` | |
| `Avatar`, `AvatarGroup` | |
| `Skeleton`, `SkeletonText`, `SkeletonCard` | |

### Capas / overlays

`Modal`, `Drawer`, `Tooltip`, `Popover`, `Toast`, `ToastProvider`/`useToast`, `CommandPalette`

### Navegación / layout

`Tabs`, `SegmentedControl`, `PageHeader`, `Section`, `Toolbar`, `ToolbarSeparator`, `FilterBar`

### Datos

`DataTable`, `EmptyState`, `Timeline`, `ActivityFeed`, `KpiCard`

### Charts (SVG hecho a mano)

`Sparkline`, `LineChart`, `AreaChart`, `BarChart`, `DonutChart`, `Heatmap`, `FunnelChart`

### Utilidades exportadas

`cx`, formatters (`formatCurrency`, …), `hexToRgb`/`mixHex`, scales (`linearScale`, …), fuzzy match, hooks (`useDebouncedValue`, `useFocusTrap`, …).

---

## Firmas reales (las más usadas)

### `Button` — `components/Button.tsx`

```ts
variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'link';
size?: 'sm' | 'md' | 'lg';
loading?: boolean;
loadingLabel?: string;
iconLeft?: ReactNode;
iconRight?: ReactNode;
fullWidth?: boolean;
iconOnly?: boolean; // exige aria-label
```

### `Badge`

```ts
tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
variant?: 'soft' | 'solid' | 'outline';
size?: 'sm' | 'md';
dot?: boolean;
```

### `KpiCard`

```ts
label: string;
value: ReactNode;
unit?: string;
delta?: number;        // 0.082 = +8.2 %
deltaLabel?: string;
invertDelta?: boolean;
trend?: readonly number[];
tone?: KpiTone;
loading?: boolean;
hint?: string;
href?: string;
```

### `DataTable`

```ts
columns: readonly DataTableColumn<T>[];
data: readonly T[];
rowKey: (row: T) => string;
label: string; // accesible, obligatorio
```

### `PageHeader`

```ts
title: ReactNode;
eyebrow?: ReactNode;
description?: ReactNode;
breadcrumbs?: readonly Breadcrumb[];
actions?: ReactNode;
bordered?: boolean; // default true
```

### `Modal`

```ts
open: boolean;
onClose: () => void;
title?: string;
description?: string;
size?: 'sm' | 'md' | 'lg' | 'xl';
footer?: ReactNode;
dismissible?: boolean;
```

### `EmptyState`

```ts
title: string;
description?: ReactNode;
illustration?: 'seats' | 'search' | 'chart' | 'inbox' | 'error' | 'success';
action?: ReactNode;
```

---

## Charts: motor interno y formato de datos

Internos (no exportados por el barrel):

- `packages/ui/src/internal/CartesianChart.tsx` — Line/Area/Bar
- `packages/ui/src/internal/ChartShell.tsx` — shell accesible + tooltip

Helpers: `lib/chart.ts`, `scale.ts`, `path.ts`, `format.ts`, `color.ts`, `cx.ts`, `hooks.ts`, `position.ts`, `fuzzy.ts`.

### Cartesianos (`LineChart` / `AreaChart` / `BarChart`)

Tipo compartido `CartesianChartProps` / `ChartSeries` (`lib/chart.ts`):

```ts
series: readonly {
  id: string;
  name: string;
  color?: string;
  data: readonly { label: string; value: number }[];
}[];
label: string; // a11y obligatorio
caption?: string;
height?: number; // default 220
formatValue?: (value: number) => string;
startAtZero?: boolean; // default true
```

`AreaChart` añade `smooth?: boolean` (default true) y `stacked?: boolean`.

### `DonutChart`

```ts
slices: readonly { id: string; label: string; value: number; color?: string }[];
label: string;
center?: ReactNode;
thickness?: number; // fracción del radio, default 0.34
```

### `FunnelChart`

```ts
stages: readonly { id: string; label: string; value: number; color?: string }[];
conversionBase?: 'total' | 'previous'; // default previous
```

### `Heatmap`

```ts
rows: readonly string[];
columns: readonly string[];
values: readonly (readonly number[])[]; // values[fila][columna]
label: string;
```

### `Sparkline`

Serie simple de `number[]` (ver props en `Sparkline.tsx`); la usa `KpiCard` embebida.

---

## Moneda y fechas es-MX / MXN

### En UI

`packages/ui/src/lib/format.ts` — locale fijo `'es-MX'`:

- `formatCurrency(value)` → `Intl` currency `MXN`
- `formatNumber`, `formatPercent`, `formatCompact`
- `formatDateTime`, `formatDayLabel`, `formatTime`, `toDate`

### En dominio / dinero entero

`packages/shared/src/money.ts`:

- Cantidades en **minor units** (`amountMinor`) — no aritmética en float
- `formatMoney(MoneyAmount)`, `formatMoneyMajor(number)`, `toMinorUnits` / `fromMinorUnits`
- `DEFAULT_CURRENCY = 'MXN'`, `DEFAULT_LOCALE = 'es-MX'`

UI formatea majors ya convertidos; shared es la fuente de verdad para aritmética.

---

## Toast: dos implementaciones

| Origen | Uso actual |
|--------|------------|
| `@/components/Toast/ToastProvider` | Montado en `apps/admin/app/layout.tsx` |
| `@boletera/ui` `ToastProvider` / `useToast` | Exportado; no es el que envuelve el root del admin hoy |

No mezcles hooks de uno con el provider del otro.

---

## Adopción parcial (honesto)

El design system **no** es el único sistema visual del admin.

Conteo al escribir esta guía (PowerShell `Get-ChildItem -Recurse -Filter '*.module.scss'`):

| Ámbito | `*.module.scss` |
|--------|-----------------|
| `apps/admin` completo | **32** |
| Solo `apps/admin/app` | **27** |
| Solo `apps/admin/components` | **5** |

Muchas pantallas siguen con estilos locales (`orders.module.scss`, `analytics.module.scss`, shell, venue-builder, …) aunque ya importen componentes de `@boletera/ui`. Orders incluso importa algunos charts por path profundo (`@boletera/ui/src/components/DonutChart`) en lugar del barrel — preferí el barrel cuando el export exista.

---

## Scripts del paquete

```powershell
pnpm --filter @boletera/ui check-types
```

No hay `build` ni `dev` propios: Next transpila el TS/SCSS en origen.

## Enlaces

- [README del paquete](../../packages/ui/README.md)
- [Nuevo módulo admin](./nuevo-modulo-admin.md)
- [Índice](./README.md)
