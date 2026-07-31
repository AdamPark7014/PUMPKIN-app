# Integración de apps con el stack de observability

Este archivo es la guía **exacta** para instrumentar apps. El directorio `infra/observability/**` ya está listo para recibir OTLP; las apps aún no exportan telemetría.

## Endpoints de ingest (local)

| Señal | Protocolo | Endpoint desde el host | Endpoint desde otro container en Docker |
|---|---|---|---|
| Traces / Metrics / Logs | OTLP gRPC | `http://127.0.0.1:4317` | `http://otel-collector:4317` |
| Traces / Metrics / Logs | OTLP HTTP | `http://127.0.0.1:4318` | `http://otel-collector:4318` |

Paths HTTP OTLP estándar:

- Metrics: `POST /v1/metrics`
- Traces: `POST /v1/traces`
- Logs: `POST /v1/logs`

## Variables de entorno recomendadas (API NestJS)

Añadir en el runtime de `apps/api` (y workers si aplica), **sin** secretos:

```env
OTEL_SERVICE_NAME=boletera-api
OTEL_SERVICE_NAMESPACE=boletera
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=local,service.namespace=boletera
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_METRICS_EXPORTER=otlp
OTEL_TRACES_EXPORTER=otlp
OTEL_LOGS_EXPORTER=otlp
OTEL_METRIC_EXPORT_INTERVAL=15000
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.2
```

Si la API corre en Docker en otra red, usa `http://host.docker.internal:4318` (Windows/macOS) o une la red `boletera-observability`.

## Dependencias a añadir en `apps/api` (pendiente)

```bash
pnpm --filter @boletera/api add \
  @opentelemetry/api \
  @opentelemetry/sdk-node \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-metrics-otlp-http \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/exporter-logs-otlp-http \
  @opentelemetry/sdk-logs \
  @opentelemetry/instrumentation-http \
  @opentelemetry/instrumentation-express \
  @opentelemetry/instrumentation-nestjs-core \
  @opentelemetry/instrumentation-pg \
  @prisma/instrumentation
```

## Bootstrap (pendiente) — cargar ANTES de Nest

Crear p.ej. `apps/api/src/otel.ts` e importarlo como **primera** línea de `main.ts` / `load-env` (o `node --require ./dist/otel.js`):

```ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { PrismaInstrumentation } from '@prisma/instrumentation';

const sdk = new NodeSDK({
  serviceName: process.env.OTEL_SERVICE_NAME ?? 'boletera-api',
  traceExporter: new OTLPTraceExporter({
    url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://127.0.0.1:4318'}/v1/traces`,
  }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://127.0.0.1:4318'}/v1/metrics`,
    }),
    exportIntervalMillis: 15_000,
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }),
    new PrismaInstrumentation(),
  ],
});

sdk.start();
process.on('SIGTERM', () => void sdk.shutdown());
```

## Contratos de métricas que esperan los SLI

Los recording rules en `prometheus/rules/ticketing-slo.yml` asumen nombres **OTel → Prometheus** (puntos a guiones bajos):

### 1) Latencia ruta compra

- Métrica: `http_server_request_duration_seconds_bucket|count`
- Labels críticos:
  - `http_route` ∈ `/api/v1/orders*`, `/api/v1/checkout*`, `/api/v1/cart*`, `/api/v1/payments/intents`, `/api/v1/payments/confirm`
  - `http_response_status_code` o equivalente
  - `service_name`

Si el SDK emite `http.server.request.duration` (histograma), el collector/Prometheus lo convierte a `http_server_request_duration_seconds_*`.

**Rutas reales actuales de la API (referencia):**

- Prefijo global: `/api/v1`
- Payments: `POST /api/v1/payments/intents`, `POST /api/v1/payments/confirm`, refunds/webhooks
- Orders: controller de orders bajo `/api/v1/orders…`
- Health ya existente (no es SLI de compra): `GET /api/v1/health`, `GET /api/v1/ready`

### 2) Error de pagos

- Misma histograma/count HTTP
- Filtrar `http_route=~"/api/v1/payments/(intents|confirm|.*refunds.*)"`
- Numerador: `http_response_status_code=~"5.."`
- SLO: ratio ≤ 0.01

### 3) Saturación DB

Preferido (semconv OTel DB client):

- `db_client_connections_usage`
- `db_client_connections_max`
- opcional: `db_client_connections_pending_requests`

Con Prisma + `PrismaInstrumentation` / pool metrics, exporta gauges de conexiones. Si usas `pg` pool directo, instrumenta `pg` y mapea usage/max.

## Logs estructurados (pendiente)

Requisitos mínimos por línea JSON (vía OTLP logs o shipper):

```json
{
  "level": "info",
  "msg": "payment.confirm.ok",
  "service_name": "boletera-api",
  "trace_id": "<hex>",
  "span_id": "<hex>",
  "http_route": "/api/v1/payments/confirm",
  "order_id": "...",
  "organization_id": "..."
}
```

No envíes PII (email, tarjeta, tokens). El datasource Loki ya intenta derivar `TraceID` → Tempo.

## Frontends (admin/web/taquilla) — opcional

Para RUM/browser:

1. `@opentelemetry/sdk-trace-web` + OTLP HTTP al collector (`4318`)
2. CORS en collector si se expone al browser (hoy **no** está abierto a LAN; preferible proxy backend)
3. Propaga `traceparent` en llamadas a la API

No es bloqueante para los SLI de ticketing definidos (son server-side).

## Probes de app (ya existen; wiring de orquestación pendiente)

Cuando despliegues API en k8s/compose de app:

```yaml
livenessProbe:
  httpGet: { path: /api/v1/health, port: 4000 }
readinessProbe:
  httpGet: { path: /api/v1/ready, port: 4000 }
```

Estos probes **no** reemplazan métricas OTel; solo ciclo de vida del proceso.

## Checklist de aceptación de instrumentación

1. `up{job="otel-collector"} == 1`
2. En Prometheus: existe `http_server_request_duration_seconds_count`
3. Tras tráfico de compra de prueba: `boletera:checkout_latency_p95_seconds` deja de ser vacío
4. Forzar 5xx en payments de staging: `boletera:payment_error_ratio` > 0
5. En Tempo: traces con `service.name=boletera-api`
6. En Loki: logs con `trace_id` navegable al trace
