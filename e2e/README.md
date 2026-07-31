# Red de seguridad E2E de TicketOS

Las pruebas se anclan a contratos HTTP, rutas, roles ARIA y nombres accesibles.
No usan clases CSS ni esperas de tiempo fijo (`waitForTimeout`). El seed
`demo-v2` es determinista; las mutaciones usan `testId` por worker.

## Preparación desde cero (PowerShell)

Requisitos: Node 22+, pnpm 10.30.3+, Docker Desktop.

```powershell
Copy-Item .env.example .env
# docker-compose expone PostgreSQL en 5434 — ajuste DATABASE_URL:
# postgresql://postgres:postgres@localhost:5434/boletera?schema=public
pnpm install
pnpm docker:up
pnpm db:migrate:deploy
pnpm db:seed
pnpm exec playwright install chromium
```

Credenciales seed: `admin@demo.boletera.com` / `Admin123!` (también
`admin@ocesa-demo.mx`, `admin@cie-demo.mx`, `taquilla@demo.boletera.com`,
`scanner@demo.boletera.com`).

## Servicios locales

Playwright (sin `E2E_NO_WEBSERVER`) levanta:

| Servicio | URL |
| --- | --- |
| API | http://127.0.0.1:4000/api/v1 |
| Web (storefront) | http://127.0.0.1:3010 |
| Admin | http://127.0.0.1:3001 |
| Taquilla | http://127.0.0.1:3002 |

También se puede levantar a mano:

```powershell
pnpm docker:up
pnpm --filter @boletera/api dev
pnpm --filter @boletera/web exec next dev --port 3010 --hostname 127.0.0.1
pnpm --filter @boletera/admin exec next dev --port 3001 --hostname 127.0.0.1
pnpm --filter @boletera/taquilla exec next dev --port 3002 --hostname 127.0.0.1
pnpm --filter @boletera/worker dev
```

El worker es **obligatorio** para liberar holds expirados
(`release-expired-holds`). Sin worker, `e2e/inventory/hold-expiry.spec.ts`
falla a propósito.

Si la API ya está arriba:

```powershell
$env:E2E_NO_WEBSERVER='1'
$env:API_URL='http://127.0.0.1:4000/api/v1'
```

## Comandos

```powershell
pnpm test:e2e                 # suite completa
pnpm test:e2e:critical        # storefront + inventory + operations + security
pnpm test:e2e:api             # contracts + security + inventory + operations
pnpm test:e2e:contracts
pnpm test:e2e:security
pnpm test:e2e:quality
pnpm test:e2e:list
pnpm test:e2e:typecheck
```

Una carpeta:

```powershell
pnpm exec playwright test -c e2e/playwright.config.ts e2e/inventory
```

## Convenciones

- TypeScript strict, sin `any`.
- Auth: `e2e/support/api.ts` cachea sesiones y hace `expect.poll` ante HTTP 429
  (login throttled a 5/min en producción).
- Workers Playwright default = 4 (`E2E_WORKERS` para ajustar).
- Seguridad: denegaciones deben ser 401/403 (no 404 como sustituto).
- Presupuesto rendimiento: `loadEventEnd ≤ 3000ms`, `LCP ≤ 4000ms`
  (`E2E_DOCUMENT_LOAD_BUDGET_MS`, `E2E_LCP_BUDGET_MS`). Justificación en
  `e2e/quality/README.md`.

## Mapa de suites

| Área | Carpeta |
| --- | --- |
| Compra storefront | `e2e/storefront/` |
| Inventario / concurrencia / expiry | `e2e/inventory/` |
| Auth + multi-tenant | `e2e/security/` |
| Taquilla + accesos | `e2e/operations/` |
| Contratos API (+ metrics) | `e2e/contracts/` |
| A11y + rendimiento | `e2e/quality/` |
| Fixtures compartidos | `e2e/support/` |
| Smoke / Banorte legado | `e2e/tests/` |
