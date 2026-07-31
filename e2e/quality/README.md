# e2e/quality — accesibilidad y rendimiento

Suite Playwright exclusiva de esta carpeta. No añade dependencias; reutiliza
`@playwright/test`, `e2e/support/*` y el `playwright.config.ts` del monorepo.

## Qué cubre

| Suite | Archivo | Criterio |
| --- | --- | --- |
| Accesibilidad | `a11y.spec.ts` | Landmarks, nombres accesibles, labels de formulario, foco de teclado, contraste WCAG 1.4.3, idioma, título, ids duplicados, texto alternativo |
| Rendimiento | `performance.spec.ts` | Navigation Timing (`loadEventEnd`) y Largest Contentful Paint contra los presupuestos de `e2e/support/environment.ts` |

Pantallas principales (web / admin / taquilla): home, login, catálogos públicos,
dashboard/eventos/órdenes del admin, home/eventos/buscar de taquilla. El
catálogo vive en `_lib/targets.ts`.

## Selectores (contrato a11y)

- Roles y nombres accesibles (`getByRole`, `getByLabel`, árbol de
  `ariaSnapshot()`).
- **Prohibido** anclarse a texto de marketing frágil o a clases CSS.
- El contraste y las etiquetas se miden con `page.evaluate` sobre el DOM
  renderizado (colores computados, composición de fondo, asociación
  `label[for]` / `aria-labelledby` / `aria-label`).

## Presupuestos de rendimiento (justificación)

Los umbrales se leen de `environment.performance` (sobreescribibles con
`E2E_DOCUMENT_LOAD_BUDGET_MS` / `E2E_LCP_BUDGET_MS`):

| Métrica | Presupuesto | Por qué |
| --- | ---: | --- |
| Document load (`PerformanceNavigationTiming.loadEventEnd`) | **3 000 ms** | Tope razonable para un document load completo en cold navigation local/CI. Por encima de 3s el TTI percibido ya degrada el funnel de compra (web) y el arranque de turno (taquilla). |
| Largest Contentful Paint | **4 000 ms** | Alineado con el umbral “needs improvement” de Chrome UX / Web Vitals (LCP bueno &lt; 2.5s, pobre &gt; 4s). 4s es el techo absoluto: cualquier LCP mayor es un bug de rendimiento real, no ruido de red. |

Sólo se miden pantallas **públicas** (sin auth) para no mezclar la latencia del
`POST /auth/login` con la carga del documento. Las pantallas autenticadas siguen
cubiertas por la suite a11y.

La sonda LCP se instala con `addInitScript` **antes** de `goto`, y la suite
espera con `waitForLoadState('load')` + `requestIdleCallback` /
`waitForFunction` (condition waits). No hay `waitForTimeout` fijos.

## Cómo ejecutar

Desde la raíz del monorepo. El `testDir` del config apunta a `e2e/tests`, así
que hay que pasar la carpeta explícitamente:

```bash
# Inventario
pnpm exec playwright test -c e2e/playwright.config.ts e2e/quality --list

# Suite completa (salta apps caídas). Si API/frontends ya corren:
#   E2E_NO_WEBSERVER=1 evita que el config intente releerlos.
pnpm exec playwright test -c e2e/playwright.config.ts e2e/quality

# Sólo a11y / sólo performance
pnpm exec playwright test -c e2e/playwright.config.ts e2e/quality/a11y.spec.ts
pnpm exec playwright test -c e2e/playwright.config.ts e2e/quality/performance.spec.ts
```

Typecheck aislado de esta carpeta:

```bash
pnpm exec tsc -p e2e/quality/tsconfig.json --noEmit
```

### URLs

`e2e/support/environment.ts` usa por defecto web en `:3010` (el `webServer` del
config de Playwright). El `dev` de `apps/web` escucha en `:3000`. Si levantas
las apps a mano, exporta:

```bash
# PowerShell
$env:WEB_URL = 'http://127.0.0.1:3000'
$env:ADMIN_URL = 'http://127.0.0.1:3001'
$env:TAQUILLA_URL = 'http://127.0.0.1:3002'
$env:API_URL = 'http://127.0.0.1:4000/api/v1'
```

Cada test hace un sondeo HTTP previo y hace `test.skip` si la app no responde;
no se inventan fallos por servicios apagados.

### Auth de pantallas protegidas

Admin y taquilla reciben sesión vía `page.request` → `POST /auth/login` con los
usuarios seed de `environment.ts`, y el access token se inyecta en
`localStorage` (`boletera_token` / `taquilla_token`) con `addInitScript` antes
de la primera navegación. Las cookies de refresh quedan en el contexto del
browser.

## Hallazgos

Cuando un test falla, el mensaje lista regla WCAG, ruta DOM/ARIA y la medida
(ratio de contraste, outline computado, etc.). Además se adjuntan
`a11y-*.json` / `perf-*.txt` al reporte de Playwright.

El contraste se omite (indeterminado) cuando el texto vive en chrome
`position: sticky|fixed` con fondo semitransparente, o cuando el fondo depende
de `background-image` / `backdrop-filter`: en esos casos el color efectivo no
es recuperable solo con CSS computado, y reportarlo como fallo sería ruido.

## TypeScript

`e2e/quality/tsconfig.json` extiende el de `e2e/` (`strict`,
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). Esta carpeta no usa
`any`.
