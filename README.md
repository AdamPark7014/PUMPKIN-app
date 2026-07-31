# Boletera Platform

Plataforma de ticketing enterprise para el mercado mexicano: venta primaria, taquilla física,
control de acceso, reventa, abonos de temporada y liquidaciones a promotores. Multi-tenant,
en MXN y es-MX, con pagos vía Banorte (tarjeta, SPEI y OXXO) y facturación CFDI 4.0.

> **Estado real.** El *spine* de compra funciona de punta a punta (inventario → hold → orden →
> pago → boleto con QR → escaneo en puerta). Alrededor de ese núcleo hay ~32 módulos de API en
> madurez desigual. Banorte corre en **modo demo** mientras no haya credenciales reales y el CFDI
> está en **sandbox**. No es un producto terminado; es una plataforma en construcción activa.
> Los matices por módulo están en [`docs/`](./docs/README.md), que es la documentación verificada
> contra el código.

---

## Qué resuelve

Un promotor (o un recinto, o una boletera white-label) necesita vender entradas para un evento sin
vender dos veces el mismo asiento, cobrar con los métodos de pago que la gente usa en México,
imprimir y validar boletos en la puerta, y saber cuánto dinero le toca. Boletera Platform es eso,
como SaaS multi-tenant: cada promotor es una `Organization` y sus datos están aislados de los demás.

Los problemas específicos que el sistema resuelve y que **no son obvios** si vienes de otro dominio
—qué es un *hold* y por qué expira, cómo se relacionan zonas, filas, asientos y niveles de precio,
qué pasa con un boleto cuando se revende— están explicados en
[**docs/dominio/ciclo-de-vida.md**](./docs/dominio/ciclo-de-vida.md). Empieza por ahí si es tu
primer día.

---

## Arquitectura en una vista

```mermaid
flowchart TB
    subgraph Clientes
        WEB["apps/web · :3000<br/>storefront del comprador"]
        ADMIN["apps/admin · :3001<br/>panel de promotor y operaciones"]
        TAQ["apps/taquilla · :3002<br/>punto de venta"]
    end

    API["apps/api · :4000<br/>NestJS · prefijo /api/v1<br/>~32 módulos de dominio"]
    WORKER["apps/worker<br/>expira holds · reconcilia SPEI"]

    PG[("PostgreSQL 16<br/>host :5434")]
    REDIS[("Redis 7 · :6379<br/>holds + colas Bull")]
    BANORTE["Banorte Payworks<br/>SPEI · OXXO"]

    WEB -->|HTTP| API
    ADMIN -->|HTTP + SSE| API
    TAQ -->|HTTP| API
    API --> PG
    API --> REDIS
    API --> BANORTE
    WORKER --> PG
    WORKER --> REDIS
    WORKER -->|endpoints internos| API

    subgraph Paquetes["packages/ (compartidos)"]
        DB["database<br/>Prisma + schema"]
        SHARED["shared<br/>tipos, dinero, contratos"]
        UI["ui<br/>design system"]
        VE["venue-engine<br/>motor de mapas WebGL2"]
        V3D["venue-3d"]
        PAY["payments"]
        CRY["crypto · QR firmado"]
        VAL["validators"]
    end

    API -.-> DB & SHARED & PAY & CRY & VE
    ADMIN -.-> UI & SHARED & VE & V3D
    WEB -.-> UI & VE & V3D
    TAQ -.-> UI & VE
    WORKER -.-> DB
```

El desglose completo —responsabilidad de cada pieza, grafo de dependencias entre workspaces, flujo
de datos de la base hasta el componente de React, y el modelo multi-tenant— está en
[**docs/arquitectura.md**](./docs/arquitectura.md).

---

## Arranque desde cero

**Requisitos:** Node ≥ 22, pnpm ≥ 10.30.3 (`corepack enable` lo instala), Docker Desktop.

Los comandos de abajo son PowerShell (Windows). En bash funcionan igual salvo la copia del `.env`.

```powershell
# 1. Dependencias del monorepo
pnpm install

# 2. PostgreSQL 16 y Redis 7 en contenedores
docker compose up -d postgres redis
```

> El contenedor de Postgres publica el puerto **5434** en el host, no el 5432, porque en Windows
> los servicios nativos de PostgreSQL suelen ocupar 5432 y 5433. Está en `docker-compose.yml`.

```powershell
# 3. Variables de entorno
Copy-Item .env.example .env
```

Ajusta en `.env` como mínimo estas dos líneas:

```dotenv
DATABASE_URL="postgresql://postgres:postgres@localhost:5434/boletera?schema=public"
JWT_SECRET="cambia-esto-por-algo-largo-y-aleatorio"
```

`DATABASE_URL` y `JWT_SECRET` son obligatorias: la API aborta el arranque si faltan
(`validateSecurityConfiguration` en `apps/api/src/main.ts`).

> **Ojo:** `.env.example` trae el puerto **5432** por defecto, que no coincide con el 5434 que
> expone `docker-compose.yml`. Es la causa número uno de "no conecta a la base" al empezar.

```powershell
# 4. Cliente de Prisma, esquema y datos de demo
pnpm db:generate
pnpm db:migrate:dev
pnpm db:seed

# 5. Levantar todo en paralelo (turbo)
pnpm dev
```

`pnpm dev` arranca api, web, admin, taquilla y worker a la vez. Para levantar solo una app:
`pnpm dev:api`, `pnpm dev:admin`, `pnpm dev:web`, `pnpm dev:taquilla`, `pnpm dev:worker`.

### Comprobar que quedó bien

```powershell
curl http://localhost:4000/api/v1/health
curl http://localhost:4000/api/v1/ready
```

Y abre **http://localhost:4000/api/docs** para el Swagger.

### Credenciales del seed

Todas usan la contraseña **`Admin123!`** (`SEED_PASSWORD` en
`packages/database/scripts/seed-lib/constants.ts`).

| Correo | Rol | Organización |
|--------|-----|--------------|
| `admin@demo.boletera.com` | `SUPER_ADMIN` | plataforma |
| `taquilla@demo.boletera.com` | `TAQUILLA` | plataforma |
| `scanner@demo.boletera.com` | `SCANNER` | plataforma |
| `cliente@demo.boletera.com` | `CUSTOMER` | — |
| `promotor@ocesa-demo.mx` | `PROMOTER` | `ocesa-live` |
| `admin@ocesa-demo.mx` | `ADMIN` | `ocesa-live` |
| `admin@cie-demo.mx` | `ADMIN` | `cie-espectaculos` |
| `venue@teatro-demo.mx` | `VENUE_MANAGER` | `teatro-nacional-mx` |

El seed crea varias organizaciones a propósito: es la forma rápida de probar el aislamiento
multi-tenant. Entra con `admin@ocesa-demo.mx` y comprueba que no ve nada de CIE.

---

## Puertos y URLs

| Servicio | Puerto | URL |
|----------|--------|-----|
| API (NestJS) | 4000 | `http://localhost:4000/api/v1` |
| Swagger | 4000 | `http://localhost:4000/api/docs` |
| Storefront (`web`) | 3000 | `http://localhost:3000` |
| Panel admin | 3001 | `http://localhost:3001` |
| Taquilla (POS) | 3002 | `http://localhost:3002` |
| PostgreSQL 16 | 5434 → 5432 | — |
| Redis 7 | 6379 | — |
| Prisma Studio | 5555 | `pnpm db:studio` |

---

## Dónde está cada cosa

### Aplicaciones

| Ruta | Paquete | Qué es |
|------|---------|--------|
| `apps/api` | `@boletera/api` | Backend NestJS 11. Prefijo global `api/v1`. ~32 módulos en `src/modules/`. Prisma 6, Redis, colas Bull, Swagger. |
| `apps/admin` | `@boletera/admin` | Panel de promotor y operaciones. Next.js 16 + React 19, App Router. Capa de datos con TanStack Query v5. Incluye el editor de recintos y la estación de escaneo. |
| `apps/web` | `@boletera/web` | Storefront del comprador: descubrimiento, selección de asientos, checkout. |
| `apps/taquilla` | `@boletera/taquilla` | Punto de venta presencial: turnos de cajero, cobro y corte de caja. |
| `apps/worker` | `@boletera/worker` | Proceso Node con colas Bull. Expira holds vencidos y reconcilia pagos SPEI. |

### Paquetes compartidos

| Ruta | Paquete | Qué es |
|------|---------|--------|
| `packages/database` | `@boletera/database` | Esquema Prisma (~42 modelos, ~33 enums), cliente generado y seed. Fuente de verdad del modelo de datos. |
| `packages/shared` | `@boletera/shared` | Tipos y utilidades compartidas: `analytics-contracts.ts` (contratos de métricas), `money.ts`, `scheduling.ts`, enums. |
| `packages/ui` | `@boletera/ui` | Design system: tokens, ~35 componentes y gráficos SVG escritos a mano. Cero dependencias de runtime. |
| `packages/venue-engine` | `@boletera/venue-engine` | Motor de mapas de recinto. `src/render/` es el renderizador WebGL2 con fallback a Canvas2D; `src/geometry/` es import/export DXF y SVG, generadores y análisis. |
| `packages/venue-3d` | `@boletera/venue-3d` | Vista 3D del recinto sobre three.js / react-three-fiber. |
| `packages/payments` | `@boletera/payments` | Integración de pagos (Banorte Payworks, SPEI, OXXO). |
| `packages/crypto` | `@boletera/crypto` | Firma y verificación de los QR de boleto. |
| `packages/validators` | `@boletera/validators` | Esquemas Zod compartidos. |

### Otros directorios

| Ruta | Qué es |
|------|--------|
| `docs/` | **Documentación verificada.** Empieza por [`docs/README.md`](./docs/README.md). |
| `e2e/` | Suites de Playwright: `contracts/`, `security/`, `inventory/`, `operations/`, `tests/`. |
| `.github/workflows/ci.yml` | CI: instala, genera Prisma, aplica esquema, typecheck de la API y tests unitarios de la API. |

---

## Comandos

Todos existen en el `package.json` de la raíz salvo donde se indique.

### Desarrollo

| Comando | Qué hace |
|---------|----------|
| `pnpm dev` | Arranca todas las apps en paralelo (turbo). |
| `pnpm dev:api` / `dev:admin` / `dev:web` / `dev:taquilla` / `dev:worker` | Arranca una sola app. |
| `pnpm build` | Build de todo el monorepo respetando el grafo de dependencias. |
| `pnpm check-types` | `tsc --noEmit` en todos los workspaces. |
| `pnpm lint` | Lint donde esté configurado (solo `api` y `web` tienen script `lint`). |
| `pnpm format` | Prettier sobre todo el repo. |

### Base de datos

| Comando | Qué hace |
|---------|----------|
| `pnpm db:generate` | Genera el cliente de Prisma. Se ejecuta solo en `postinstall` y `predev`. |
| `pnpm db:migrate:dev` | Crea y aplica migraciones en desarrollo. |
| `pnpm db:migrate:deploy` | Aplica migraciones pendientes (producción/CI). |
| `pnpm db:seed` | Carga los datos de demo. |
| `pnpm db:studio` | Prisma Studio. |
| `pnpm db:reset` | Borra la base, re-aplica migraciones y vuelve a sembrar. **Destructivo.** |

### Pruebas

| Comando | Qué hace |
|---------|----------|
| `pnpm test` | Tests unitarios de todos los workspaces que tengan script `test`. |
| `pnpm test:e2e` | Playwright con `e2e/playwright.config.ts`. Requiere la app levantada. |
| `pnpm test:e2e:contracts` / `security` / `critical` / `api` | Subconjuntos de e2e (ver scripts en el `package.json` raíz). |
| `pnpm smoke:api` | Smoke del estado interactivo de la API (`apps/api/scripts/smoke-interactive-status.cjs`). |
| `pnpm smoke:venue-engine` | Compila y ejecuta los smokes del motor de mapas. |

### Docker e infraestructura

| Comando | Qué hace |
|---------|----------|
| `pnpm docker:up` | Levanta **solo** Postgres y Redis (`docker compose up -d --wait postgres redis`). Es lo correcto en desarrollo. |
| `pnpm docker:up:stack` | Intenta levantar también api/web/admin. **Evitar por ahora** — ver advertencia abajo. |
| `pnpm docker:down` / `docker:reset` | Baja el compose; `reset` además borra volúmenes. |
| `pnpm docker:logs` | Sigue los logs del compose. |
| `pnpm bootstrap` | Script PowerShell de arranque guiado (`scripts/bootstrap.ps1`). |
| `pnpm infra:verify` | Verifica que la infra local responde (`scripts/verify-infra.ps1`). |
| `pnpm ci:verify` | `turbo run check-types lint test build` — el mismo conjunto que debería pasar en CI. |

> **Advertencia sobre `docker:up:stack`:** los servicios `api`, `web` y `admin` declaran
> `networks: boletera-network` pero `postgres` y `redis` no, así que quedan en redes distintas y la
> resolución DNS interna (`postgres`, `redis`) falla desde el contenedor de la API. Usa
> `pnpm docker:up` (solo Postgres + Redis) y corre las apps con `pnpm dev` hasta que se corrija.

---

## Cómo está construida la capa de datos del admin

Es lo que más ha cambiado recientemente y lo que más confunde si vienes del código anterior.

```
componente React
      ↓  hook de dominio
apps/admin/lib/queries/*.ts      useQuery / useMutation de TanStack Query v5
      ↓  clave de caché
apps/admin/lib/query-keys.ts     fábrica jerárquica: all / list(filters) / detail(id)
      ↓  petición
apps/admin/lib/http.ts           cliente tipado, credentials: include, CSRF,
                                 refresh deduplicado y jerarquía de errores
      ↓
API /api/v1/*
```

Reglas prácticas:

- **Nada de `fetch` crudo ni de `useEffect` para cargar datos.** Usa un hook de
  `apps/admin/lib/queries/`. Si no existe, créalo.
- **Nada de tokens en `localStorage`.** La sesión va en cookies httpOnly; el cliente HTTP añade
  `credentials: 'include'` y la cabecera `X-CSRF-Token` en las peticiones que cambian estado.
- Las claves de caché salen siempre de `queryKeys`, nunca escritas a mano.
- Los tiempos de frescura por dominio están en `apps/admin/app/providers.tsx`
  (por ejemplo: órdenes 30 s, analytics 15 s, recintos 10 min).
- Las actualizaciones en vivo llegan por SSE y escriben directo en la caché de Query
  (`apps/admin/lib/use-realtime.ts`).

Guía completa: [docs/guias/nuevo-modulo-admin.md](./docs/guias/nuevo-modulo-admin.md).
El porqué: [ADR-0001](./docs/adr/0001-tanstack-query-en-lugar-de-useeffect-fetch.md).

---

## Seguridad

La sesión se basa en cookies httpOnly con refresh rotatorio y detección de reuso, CSRF por double
submit, RBAC por roles y permisos, y aislamiento multi-tenant vía `TenantContextService`.

El contrato completo de integración —qué debe hacer cada cliente, cómo se rota el refresh, cómo se
adopta el ámbito de tenant en un módulo— vive en
[**apps/api/src/modules/auth/SECURITY-MIGRATION.md**](./apps/api/src/modules/auth/SECURITY-MIGRATION.md).
Es la fuente de verdad; la documentación de `docs/` lo enlaza y no lo duplica.

Dos cosas que hay que saber antes de tocar la API:

1. **El aislamiento de tenant es responsabilidad manual de cada servicio.** No hay row-level
   security en PostgreSQL ni extensión del cliente de Prisma. Si escribes una consulta sin
   `organizationId` en el `where`, filtras datos entre organizaciones y nada te avisa.
   Lee [docs/guias/consultas-multi-tenant.md](./docs/guias/consultas-multi-tenant.md).
2. **La migración a cookies es parcial.** El cliente HTTP del admin todavía envía
   `Authorization: Bearer` cuando hay token en memoria, y `/auth/refresh` sigue devolviendo un
   `accessToken` transitorio. Está documentado como paso intermedio, no como diseño final:
   [ADR-0003](./docs/adr/0003-cookies-httponly-en-lugar-de-token-en-localstorage.md).

---

## Documentación

Toda la documentación verificada está en [**docs/**](./docs/README.md):

- [Arquitectura](./docs/arquitectura.md)
- [Decisiones de arquitectura (ADR)](./docs/adr/README.md)
- [Guías de desarrollo](./docs/guias/README.md)
- [Dominio de ticketing](./docs/dominio/ciclo-de-vida.md) y [glosario bilingüe](./docs/dominio/glosario.md)
- [Referencia de la API](./docs/api/README.md) y [referencia de métricas](./docs/api/metricas.md)

> Los demás `.md` de la raíz (`ARCHITECTURE.md`, `API_REFERENCE.md`,
> `ENTERPRISE_SPECIFICATION.md`, `COMPETITIVE_ARCHITECTURE.md`, `DOCUMENTATION_INDEX.md` y
> compañía) son documentos heredados y en buena parte aspiracionales: describen Stripe, PayPal,
> Kubernetes, scoring de fraude con ML y despliegue multi-región, nada de lo cual existe en el
> código. Trátalos como notas históricas.

---

## Licencia

Privado — uso interno de Boletera.
