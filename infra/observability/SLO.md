# SLI / SLO — Ticketing Boletera

## Objetivos

| ID | SLI | Definición | SLO | Ventana alerta |
|---|---|---|---|---|
| TKT-LAT | Latencia ruta compra | p95 de duración HTTP en rutas de órdenes/checkout + payment intent/confirm | ≤ 1.5 segundos | 5m burn, `for: 5m` |
| TKT-PAY | Error pagos | Proporción de respuestas 5xx en rutas de payments (intents/confirm/refunds) | ≤ 1% | 5m, `for: 5m` |
| TKT-DB | Saturación DB | `connections_usage / connections_max` (pool) | ≤ 85% | 5m, `for: 5m` |

## Error budget (referencia operativa)

Asumiendo mes de 30 días:

- Latencia: presupuesto ≈ tiempo en que p95 > 1.5s; alerta warning a los 5m continuos.
- Pagos: ≤ 1% 5xx → budget 99% éxito HTTP server-side (no incluye 4xx de negocio).
- DB: saturación > 85% durante 5m = riesgo de cola / timeouts en checkout.

## Fuentes

- Recording + alerting Prometheus: `prometheus/rules/ticketing-slo.yml`
- Grafana unified alerting mirror: `grafana/provisioning/alerting/ticketing-slo.yaml`
- Dashboard: `grafana/dashboards/ticketing-slo.json`

## Estado actual

Reglas y paneles **provisionados y válidos**. Series de negocio = **NoData** hasta completar `APP_INTEGRATION.md`.
