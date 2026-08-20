# Deep research: Mercado Pago + boleteras (México)

Fecha de investigación: **2026-08-20**. Alcance: cómo se integra MP en venta de
entradas / entretenimiento y qué implica para Pumpkin / Boletera.

## Respuesta corta

Para una boletera en México el patrón correcto es **Checkout Pro + webhook firmado
como única fuente de verdad** (nunca el `back_url`). Hay que alinear **hold de
inventario** con el tiempo real de OXXO/SPEI (horas, no minutos). La comisión
publicada suele citarse como **3.49% + $4 MXN** en liberación inmediata; el
simulador oficial exige login — verifica el costo *con IVA* en tu cuenta antes de
fijar precio final.

## Hallazgos

### 1. Producto de integración (oficial)

| Pieza | Dato | Fuente | Fecha |
|-------|------|--------|-------|
| Producto típico e-commerce / eventos | Checkout Pro (redirect a entorno MP) | [Docs Checkout Pro MX](https://www.mercadopago.com.mx/developers/es/docs/checkout-pro/overview) | consultado 2026-08-20 |
| Medios MX en Checkout Pro | Tarjeta, SPEI, OXXO, Paycash, bancos, saldo MP, MSI | misma | 2026-08-20 |
| Prerrequisitos | Cuenta vendedor + SSL HTTPS | misma | 2026-08-20 |
| Flujo | Preferencia → `init_point` → pago en MP → webhook `payment` → GET `/v1/payments/{id}` | [Payment notifications](https://www.mercadopago.com.mx/developers/es/docs/checkout-pro/payment-notifications) | 2026-08-20 |
| Firma webhook | Header `x-signature` (HMAC); secret en Tus integraciones | misma | 2026-08-20 |
| Pruebas | Pagos con credenciales TEST **no** disparan webhooks reales; usar simulador del panel | docs notifications (WARNING) | 2026-08-20 |

### 2. Datos de industria “tickets & entertainment” (oficial)

MP documenta campos `additional_info.items[].event_date` y categoría Tickets para
**mejorar aprobación** en Checkout API (`/v1/payments`). En Checkout Pro la
preferencia acepta `items[].category_id` (p. ej. `tickets`) y metadatos del ítem;
el payload completo de industry-data está pensado sobre todo para Checkout API.

Fuente primaria: [Tickets and entertainment](https://www.mercadopago.com.mx/developers/es/docs/checkout-api-payments/additional-content/industry-data/tickets-and-entretainment) (consultado 2026-08-20).

### 3. Comisiones (México) — con contradicción visible

| Fuente | Comisión citada (liberación inmediata) | IVA | Fecha |
|--------|----------------------------------------|-----|-------|
| Blog oficial MP Hot Sale 2026 | 3.49% + $4.00; 7 días 3.19%+$4; 30 días 2.95%+$4 | no desglosa IVA en el post | [Hot Sale integra MP](https://www.mercadopago.com.mx/blog/hot-sale-integra-mercado-pago) (contenido 2026) |
| Blog tercero (atempora) | mismas cifras + apunta a ayuda oficial | recomienda sumar IVA | 2026-08-17 |
| Calculadora TSPayy | 3.49% + $4; menciona “+ IVA” en texto | ambiguo | dice verificado 2026-03-20 |
| Página ayuda costos `/ayuda/costo-recibir-pagos_683` | **No legible** (wall de cookies / login en fetch) | — | intento 2026-08-20 |
| Simulador `/cost-simulator` | **Requiere login** | — | 2026-08-20 |

**Conclusión de costo:** usar **3.49% + $4 MXN** como cifra de trabajo *sin confirmar IVA*
hasta mirarlo en el panel / simulador logueado. No fijar margen de boletera solo con blogs.

### 4. Cómo lo hacen las boleteras en la práctica (terreno)

| Hallazgo | Evidencia | Implicación |
|----------|-----------|-------------|
| OXXO deja la reserva **pendiente ~24 h** | [Boletia KB](https://knowledge.boletia.com/knowledge/por-qu%C3%A9-tengo-reservaciones-pendientes-en-mi-evento) (sin fecha en página) | El inventario no puede liberarse a los 15–30 min |
| Redirect ≠ pago | Experiencia ingeniería 2026 ([cesarayala.dev](https://cesarayala.dev/blog/how-to-integrate-mercado-pago/)) + docs MP | Completar orden solo con `status=approved` vía API tras webhook |
| Vencimiento offline | MP recomienda `date_of_expiration` ≥ **3 días** | [Expiration date](https://www.mercadopago.com.mx/developers/es/docs/checkout-pro/checkout-customization/preferences/expiration-date) | En boletera hay tensión: voucher largo vs hold corto = sobreventa |

### 5. Alta / fiscal (México)

| Tema | Dato | Fuente | Confianza |
|------|------|--------|-----------|
| Cuenta negocio + RFC | Constancia de Situación Fiscal; persona moral 12 chars RFC | [Blog MP RFC](https://www.mercadopago.com.mx/blog/dar-de-alta-rfc-cuenta-negocio) | Alta (oficial, marketing) |
| Tiempo verificación | “horas a ~1–3 días hábiles” (límites) | [Límites depósito RFC](https://www.mercadopago.com.mx/blog/limites-deposito-cuenta-negocio-rfc) | Media (no es SLA contractual) |
| Sin RFC | Retenciones / límites más agresivos | mismos blogs | Media |

### 6. Contracargos

MP expone gestión de chargebacks vía API y docs Checkout Pro. Tras `charged_back`
hay que defender con documentación si `documentation_required=true`.
Fuente: [Gestionar contracargos](https://www.mercadopago.com.mx/developers/es/docs/checkout-pro/additional-content/chargebacks/how-to-manage).

## Contradicciones y huecos

1. **Comisión con/sin IVA:** blogs repiten 3.49%+$4; no se pudo leer el tarifario oficial sin sesión. **Sin confirmar** el costo total al vendedor.
2. **TTL recomendado 3 días (MP) vs hold 24 h (boleteras) vs hold histórico Boletera 15–30 min:** hay que elegir política de negocio (sobreventa vs conversión OXXO).
3. **Industry-data** documentado para `/v1/payments` (Checkout API); Checkout Pro usa preferencias — el mapeo 1:1 de todos los campos no está garantizado.
4. No hay evidencia pública de un “producto Mercado Pago Boletera” aparte: es Checkout Pro + reglas de inventario propias.

## Qué verificar antes de decidir / lanzar

- [ ] Simulador de costos logueado en la cuenta de la empresa (IVA + plazo de liberación).
- [ ] Tiempo real de alta/verificación con la Constancia Fiscal de la razón social.
- [ ] Política OXXO: ¿24 h o 72 h de hold? (inventario bloqueado = menos aforo vendible).
- [ ] SMTP de entrega de QR listo antes de abrir venta (pago aprobado sin correo = soporte).
- [ ] Webhook HTTPS público + secret; prueba con simulador del panel (no solo TEST checkout).
- [ ] MSI: si se activan, la comisión adicional la absorbe el vendedor — ver panel Comisiones y MSI.

## Implicaciones aplicadas en este repo (Pumpkin / Boletera)

Tras esta investigación el código:

1. Extiende hold/orden/preferencia a **`MP_PENDING_TTL_HOURS` (default 24)** cuando la pasarela es Mercado Pago.
2. Envía `date_of_expiration`, `category_id=tickets`, `event_date` (si hay), nombre/apellido del payer.
3. Sigue completando la orden **solo** vía webhook + GET payment (ya implementado).
4. Gating de `/boletos` exige `gateway=MERCADOPAGO` (credenciales reales).

## Fuentes

**Primarias**

- https://www.mercadopago.com.mx/developers/es/docs/checkout-pro/overview
- https://www.mercadopago.com.mx/developers/es/docs/checkout-pro/payment-notifications
- https://www.mercadopago.com.mx/developers/es/docs/checkout-pro/checkout-customization/preferences/expiration-date
- https://www.mercadopago.com.mx/developers/es/docs/checkout-api-payments/additional-content/industry-data/tickets-and-entretainment
- https://www.mercadopago.com.mx/developers/es/docs/checkout-pro/additional-content/chargebacks/how-to-manage
- https://www.mercadopago.com.mx/blog/hot-sale-integra-mercado-pago

**Secundarias / terreno**

- https://knowledge.boletia.com/knowledge/por-qu%C3%A9-tengo-reservaciones-pendientes-en-mi-evento
- https://cesarayala.dev/blog/how-to-integrate-mercado-pago/
- https://atempora.studio/blog/comisiones-mercado-pago-2026
