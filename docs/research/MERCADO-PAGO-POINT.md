# Deep research: Mercado Pago Point + credenciales (boletera MX)

Fecha: **2026-08-20**.

## Respuesta corta

Para Pumpkin: **una sola cuenta MP** con app que declare **pagos online (Checkout Pro)
y pagos presenciales (Point)**. El Access Token de producción (`APP_USR-…`) va solo
en el backend. Las terminales deben estar en modo **PDV**; si quedan en Standalone,
la API crea órdenes pero la máquina las ignora. Webhooks Point usan topic **Order**,
no solo Payments.

## Hallazgos

### Credenciales (oficial)

| Dato | Fuente | Fecha |
|------|--------|-------|
| Access Token = clave privada backend; Public Key = frontend | [Credentials](https://www.mercadopago.com.mx/developers/es/docs/your-integrations/credentials) | consultado 2026-08-20 |
| Producción exige activar: industria + URL sitio + T&C | misma | 2026-08-20 |
| También existen Client ID / Client Secret (OAuth / terceros) | misma | 2026-08-20 |
| Renovar credenciales rompe integraciones hasta reemplazarlas | misma | 2026-08-20 |
| Enviar token en header `Authorization: Bearer`, nunca query | misma | 2026-08-20 |
| App details: elegir Online y/o In-person payments | [Application details](https://www.mercadopago.com.mx/developers/es/docs/your-integrations/application-details) | 2026-08-20 |

### Point (oficial + terreno)

| Dato | Fuente | Fecha |
|------|--------|-------|
| Flujo: crear orden API → terminal carga → cobro → webhook | [Point overview](https://www.mercadopago.com.mx/developers/es/docs/mp-point/overview) | 2026-08-20 |
| API vigente: `POST /v1/orders` type `point` + `config.point.terminal_id` | [Payment processing](https://www.mercadopago.com.mx/developers/es/docs/mp-point/payment-processing) | 2026-08-20 |
| Amount como **string** con 2 decimales; `X-Idempotency-Key` obligatorio | misma | 2026-08-20 |
| Webhooks: `order.processed`, canceled, refunded, failed, expired, action_required | [Point notifications](https://www.mercadopago.com.mx/developers/es/docs/mp-point/notifications) | 2026-08-20 |
| Fallo #1: terminal en Standalone | [Troubleshooting](https://www.mercadopago.com.mx/developers/es/docs/mp-point/resources/troubleshooting) + terreno 2026 | 2026 |
| Payment Intent legacy deprecado → Orders API | Prompt MP migrate + blogs 2026 | 2026 |

### Contrario (qué falla)

1. Confundir Access Token con webhook secret.  
2. Webhook sin HTTP 200 en <22s → reintentos cada 15 min.  
3. Topic mal configurado (Payments vs Order) para Point.  
4. Token TEST en producción o al revés.  
5. Terminal no re-asociada a cuenta prod al salir de sandbox.

## Contradicciones y huecos

- Modelos exactos Point Smart 1 vs 2 y stock: depender de tienda MP al comprar.  
- Comisiones Point presencial: **sin confirmar aquí** — mirar panel / “Check the processing rates” en overview.  
- Una vs dos aplicaciones (online + Point): docs permiten una app con ambos productos; dos apps también posible — sin evidencia de que sea obligatorio.

## Qué verificar antes de comprar/integrar

- [ ] RFC y liquidación de la razón social listos  
- [ ] Industria “entretenimiento / eventos / tickets” al activar prod  
- [ ] URL prod `https://pumpkin.experiencebt.com.mx`  
- [ ] Cuántas terminales y si necesitan impresión  
- [ ] Plan: Standalone temporal (cobro manual) vs PDV integrado desde día 1  

## Fuentes

Primarias: credentials · application-details · mp-point/overview · payment-processing · notifications · troubleshooting · go-to-production.
