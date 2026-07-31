# ADR-0005: Design system centralizado en lugar de SCSS por página

- **Estado**: Aceptada, adopción parcial
- **Fecha**: no determinable desde el repositorio
- **Ámbito**: `packages/ui` (tokens + componentes), consumidores en `apps/admin` (y otras apps)

## Contexto

Sin un sistema de diseño compartido, cada pantalla inventa espaciado, color y tipografía. El monorepo centraliza tokens y componentes en `@boletera/ui`, pero el admin **sigue** teniendo muchos CSS Modules por ruta. Ambos enfoques conviven hoy.

## Alternativas consideradas

| Opción | Ventajas | Por qué se descartó / límite |
|--------|----------|------------------------------|
| Solo `*.module.scss` por página | Autonomía de equipos de feature | Drift visual; imposible theming global coherente |
| Tailwind utility-only | Velocidad de prototipo | Choca con el modelo de tokens SCSS+TS ya invertido; no es el lenguaje del paquete `ui` |
| CSS-in-JS runtime | Temas dinámicos en JS | Coste runtime y SSR; el repo apuesta por SCSS + custom properties |
| **Design system `@boletera/ui` + modules locales residuales** | Componentes y tokens únicos; escape hatch por página | — (elegida; la deuda es migrar pages) |

## Decisión

1. **Tokens SCSS** en `_variables.scss` (paleta + mapas; no emite CSS) reexportados por `tokens.scss`; **custom properties** globales en `theme.scss` (importadas una vez vía `apps/admin/app/globals.scss`).
2. **Tokens TS** en `tokens.ts`: documentados como *“espejo tipado”* de `_variables.scss` / `theme.scss` para SVG, layout JS y animaciones.
3. **Componentes** exportados explícitamente desde `packages/ui/src/index.ts` (Button, Input, DataTable, charts, etc.) + util `cx`.
4. Las páginas admin pueden componer UI del paquete **y** seguir usando `*.module.scss` para layout de feature.

### Adopción parcial (conteo verificado)

`Get-ChildItem -Path apps\admin\app -Recurse -Filter *.module.scss` → **26** módulos, entre ellos:

- Shell/plataforma: `shell.module.scss`, `table.module.scss`, `_styles/platform.module.scss`
- Features: `analytics`, `audit`, `dashboard`, `events`, `orders`, `scanner`, `venues`, `fraud/suite`, `reports`, `settings/*`, etc.
- Auth: `login/login.module.scss`

Conclusión: la decisión del design system está **aceptada**, pero la migración visual del admin es **parcial**; conviven tokens/componentes centralizados y estilos por página.

### Sincronización SCSS ↔ TS (fuente de bugs)

`tokens.ts` dice ser un espejo de `_variables.scss`. **No hay generador automático** en el repo (búsqueda sin scripts de sync). La evidencia de muestreo (`#f03562` / `#e11d48`, `#1b1f27`, grises/success/danger/info) muestra valores **alineados hoy**, pero el mantenimiento es **manual**: un cambio en un solo lado produce drift silencioso (sobre todo en charts SVG que leen literales de `palette` o en CSS que lee `$accent-*`).

## Consecuencias

- **Positivas**: tema global (`--bl-*`), componentes reutilizables, charts acoplados a tokens, tree-shaking por exports nombrados.
- **Negativas**: duplicación visual mientras existan 26 modules; riesgo de desync SCSS/TS; comentarios locales (p. ej. en `analytics.module.scss`) aún hablan de “layout raíz todavía no importe theme” aunque `globals.scss` sí lo importa — señal de docs internas desactualizadas.
- **Obligaciones**:
  - Nuevos componentes visuales reutilizables → `@boletera/ui`, no copiar a un module de página.
  - Al cambiar un color/espacio en `_variables.scss`, actualizar el espejo `tokens.ts` (y viceversa) en el mismo cambio.
  - Preferir tokens semánticos (`var(--bl-*)`) frente a hex sueltos en modules nuevos.

## Evidencia en el código

- `packages/ui/src/styles/_variables.scss` — tokens SCSS (sin emitir CSS)
- `packages/ui/src/styles/tokens.scss` — `@forward` de variables
- `packages/ui/src/styles/theme.scss` — custom properties globales (consumido por admin)
- `packages/ui/src/styles/tokens.ts` — espejo tipado (comentario de mantenimiento manual)
- `packages/ui/src/index.ts` — inventario de exports
- `packages/ui/src/lib/cx.ts` — utilidad de classNames
- `apps/admin/app/globals.scss` — `@use …/theme.scss`
- `apps/admin/app/**/*.module.scss` — **26** CSS Modules (adopción parcial)
