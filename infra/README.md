# TicketOS / Boletera — Infrastructure

Propiedad DevOps/SRE. No contiene código de aplicación.

## Layout

| Path | Owner | Purpose |
|------|-------|---------|
| `docker-compose.yml` + `.env.example` | Local env | Postgres/Redis (+ optional app services) |
| `docker/` | Production images | Multi-stage Dockerfiles (`api`, `worker`, Next apps) |
| `infra/observability/` | Observability | OTel Collector, Prometheus, Grafana, Loki, Tempo |
| `infra/runbooks/` | Ops | Deploy, rollback, backup/restore, on-sale, payments |
| `scripts/` | Ops automation | Bootstrap + infra verification (PowerShell) |
| `.github/workflows/` | CI | Typecheck, lint, tests, build, e2e, audit, secrets |

## Canonical environment variables

Use these names everywhere (Compose, CI, k8s, docs). Never invent aliases.

### Required (boot)

| Variable | Secret | Notes |
|----------|--------|-------|
| `DATABASE_URL` | yes | Prisma runtime URL (host port **5434** for local Compose) |
| `JWT_SECRET` | yes | Required by API in production |
| `INTERNAL_API_SECRET` | yes | Worker ↔ API reconcile / schedule tick |
| `REDIS_URL` | no* | Required for holds/queues; API readiness tolerates Redis down |

\*Treat credentials inside Redis URL as secret when remote.

### Strongly recommended

| Variable | Secret | Notes |
|----------|--------|-------|
| `DIRECT_DATABASE_URL` | yes | Migrations when `DATABASE_URL` points at a pooler |
| `API_PORT` / `API_HOST` | no | Default `4000` / `0.0.0.0` |
| `API_PUBLIC_URL` | no | Banorte IPN base URL |
| `API_INTERNAL_URL` | no | Worker calls into API |
| `CORS_ORIGIN` | no | Comma-separated origins |
| `NEXT_PUBLIC_API_URL` | no | Web + taquilla |
| `NEXT_PUBLIC_ADMIN_API_URL` | no | Admin |
| `WEB_URL` / `NEXT_PUBLIC_WEB_URL` | no | Links in emails / SEO |
| `LOG_LEVEL` | no | `debug`\|`info`\|`warn`\|`error` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | no | e.g. `http://127.0.0.1:4318` |
| `OTEL_SERVICE_NAME` | no | Per-process service name |

### Payments / integrations (secrets marked)

Banorte: `BANORTE_MERCHANT_ID`, `BANORTE_AFFILIATION`, `BANORTE_USER`, `BANORTE_API_SECRET` (**secret**), `BANORTE_WEBHOOK_SECRET` (**secret**), `BANORTE_ACCOUNT_CLABE`, Payworks URLs, return/cancel.
PayPal: `PAYPAL_MODE`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` (**secret**).
SMTP: `SMTP_*`, `MAIL_FROM`.
OAuth admin: `GOOGLE_*`, `MICROSOFT_*`, `OAUTH_ADMIN_REDIRECT_URI`.
Storage: `AWS_*`.
Worker: `WORKER_CONCURRENCY`, `WORKER_HEALTH_PORT` (default `4100`), queue names.

## Quick start (new developer)

```powershell
# From repo root
pnpm bootstrap
# or full interactive:
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap.ps1
```

Manual equivalent:

```powershell
Copy-Item .env.example .env   # if missing; edit secrets/placeholders
pnpm docker:up                # or: docker compose up -d --wait postgres redis
pnpm install
pnpm db:migrate:deploy
pnpm db:seed
pnpm dev
```

Health endpoints (verified in API code):

- `GET http://127.0.0.1:4000/api/v1/health`
- `GET http://127.0.0.1:4000/api/v1/ready` (503 if DB down)

Worker:

- `GET http://127.0.0.1:4100/health`
- `GET http://127.0.0.1:4100/ready`
- `GET http://127.0.0.1:4100/metrics` (JSON snapshot, not Prometheus text yet)

## Observability

```powershell
$env:GRAFANA_ADMIN_PASSWORD = 'change-me-local-only'
pnpm observability:up
```

UI: Grafana `http://127.0.0.1:3003`, Prometheus `http://127.0.0.1:9090`, OTLP `4317/4318`.

Apps must export OTLP; see `infra/observability/` and runbooks. Until Nest/Next are instrumented, SLI panels stay empty — infrastructure is ready.

## Production images

```powershell
docker build -f docker/api.Dockerfile --ignorefile docker/.dockerignore -t boletera-api .
docker build -f docker/worker.Dockerfile --ignorefile docker/.dockerignore -t boletera-worker .
```

Prefer `docker/.dockerignore` over root `.dockerignore` for monorepo builds.

## Runbooks

Start at [`infra/runbooks/README.md`](./runbooks/README.md).
