# Observability stack — Boletera

Stack separado del compose principal de la app. Proveee logs estructurados, métricas y trazas con:

- OpenTelemetry Collector (OTLP gRPC/HTTP)
- Prometheus (scrape + reglas SLI/SLO)
- Grafana (datasources, dashboards, alertas)
- Loki (logs vía OTLP)
- Tempo (trazas vía OTLP)

## Arranque

Prerrequisitos: Docker Desktop / Compose v2.

```powershell
cd infra/observability
Copy-Item .env.example .env   # si aún no existe
# Edita GRAFANA_ADMIN_PASSWORD en .env (valor local; no uses secretos de prod)
docker compose --env-file .env -f compose.yaml up -d
```

Validación rápida de configs (sin levantar):

```powershell
cd infra/observability
.\scripts\validate.ps1
```

Health / readiness (host):

```powershell
.\scripts\health-check.ps1
```

| Servicio | URL local | Probe |
|---|---|---|
| Grafana | http://127.0.0.1:3003 | `/api/health` |
| Prometheus | http://127.0.0.1:9090 | `/-/ready` |
| Loki | http://127.0.0.1:3100 | `/ready` |
| Tempo | http://127.0.0.1:3200 | `/ready` |
| OTel Collector | http://127.0.0.1:13133 | `/` (health_check) |
| OTLP gRPC | `127.0.0.1:4317` | ingest |
| OTLP HTTP | `http://127.0.0.1:4318` | ingest |

Parar / limpiar:

```powershell
docker compose -f compose.yaml down
# volúmenes:
docker compose -f compose.yaml down -v
```

## SLI / SLO ticketing (definidos en Prometheus + Grafana)

| SLI | Query / recording rule | SLO | Alert |
|---|---|---|---|
| Latencia ruta compra | `boletera:checkout_latency_p95_seconds` sobre rutas `/api/v1/orders*`, checkout/cart, `/api/v1/payments/intents`, `/api/v1/payments/confirm` | p95 ≤ **1.5s** (ventana 5m, for 5m) | `CheckoutLatencySLOBurn` |
| Error pagos | `boletera:payment_error_ratio` = 5xx / total en `/api/v1/payments/(intents\|confirm\|*refunds*)` | error ratio ≤ **1%** | `PaymentErrorRateHigh` |
| Saturación DB | `boletera:db_saturation_ratio` desde `db_client_connections_*` | uso pool ≤ **85%** | `DatabaseSaturationHigh` |

Dashboards provisionados:

- `Boletera Ticketing SLI/SLO`
- `Boletera Observability Infra Health`

Alertas Grafana de SLI usan `noDataState: OK` mientras no haya telemetría de app (evita falsos positivos). El contact point por defecto es un webhook local noop (127.0.0.1:9); sustituye en provisioning/UI por Slack/PagerDuty/email real (sin commitear tokens).

## Qué es verificable HOY vs instrumentación pendiente

### Verificable con este stack (sin cambios de app)

- Compose healthy: collector, Prometheus, Loki, Tempo, Grafana
- Scrapes `up{job=...}` = 1
- Prometheus carga `prometheus/rules/ticketing-slo.yml`
- Grafana datasources Prometheus/Loki/Tempo
- Dashboards y alert rules provisionados (pueden estar en **NoData** hasta que exista telemetría de app)
- Health endpoints de infraestructura listados arriba
- API Boletera ya expone (fuera de este directorio, solo referencia):
  - `GET /api/v1/health`
  - `GET /api/v1/ready`
  Útiles para probes de orquestación de la app; **no** alimentan aún métricas OTel.

### Pendiente en apps (bloqueos — este agente NO puede editar apps)

Hoy `apps/api` **no** declara dependencias `@opentelemetry/*` ni `prom-client`. Sin instrumentación:

1. No hay métricas `http_server_request_duration_seconds_*` → SLI latencia/errores = NoData
2. No hay métricas `db_client_connections_*` → SLI saturación DB = NoData (o 0 vía `or vector(0)` en recording rule)
3. No hay export OTLP de logs/traces → Loki/Tempo vacíos de negocio
4. No hay correlación `trace_id` en logs de aplicación

Instrucciones exactas de integración: ver `APP_INTEGRATION.md`.

## Puertos y seguridad local

- Todos los binds son `127.0.0.1` (no expuestos a LAN).
- No hay API keys ni passwords de producción en el repo.
- `GRAFANA_ADMIN_PASSWORD` solo vía `.env` (ignorado por git).
