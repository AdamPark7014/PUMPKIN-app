# Checklist integración Mercado Pago perfecta (Pumpkin / Boletera)

Fecha: **2026-08-20**. Cruza código del repo con docs oficiales MX.

## A. Online (Checkout Pro) — estado

| Paso | Estado | Notas |
|------|--------|-------|
| App en Tus integraciones | **Pendiente cuenta** | Crear con productos Online + In-person |
| Access Token producción `APP_USR-` | **Pendiente** | Backend only; nunca en frontend |
| Webhook topic **Payments** | **Código listo** | URL `/api/v1/payments/webhooks/mercadopago` |
| `MP_WEBHOOK_SECRET` + firma x-signature | **Código listo** | Obligatorio en prod |
| Preferencia + redirect | **Listo** | `mercadopago.provider.ts` |
| Completar orden solo con webhook+GET | **Listo** | No confiar back_urls |
| Hold 24h OXXO/SPEI | **Listo** | `MP_PENDING_TTL_HOURS` |
| Reembolso por gateway MP | **Listo** (fix 2026-08-20) | Antes iba a Banorte |
| SMTP correo QR | **Pendiente ops** | Sin SMTP no hay entrega |
| Contracargos defensa API | **Falta** | Solo mapea charged_back |
| Quality measurement MP | **Pendiente** | Tras 1er pago prod |
| Credenciales en VPS `.env` | **Pendiente** | Ver `deploy/pumpkin.env.example` |

## B. Point (terminales físicas) — estado

| Paso | Estado | Notas |
|------|--------|-------|
| Comprar Point Smart 1/2 | **Pendiente compra** | [Store MP](https://www.mercadopago.com.mx/herramientas-para-vender/point) |
| App MP en celular + vincular terminal | **Pendiente** | QR de producción |
| App con producto **In-person / Point** | **Pendiente** | Misma cuenta o app separada |
| Modo **PDV** (no Standalone) | **Crítico** | Sin PDV la API no empuja cobros |
| `GET /terminals/v1/list` | **Falta código** | Listar `terminal_id` |
| `POST /v1/orders` type=point | **Falta código** | Orders API (no Payment Intent legacy) |
| Webhook topic **Order (Mercado Pago)** | **Parcial** | Handler `type=order` añadido; taquilla aún no crea órdenes Point |
| Taquilla CARD vía Point API | **Falta** | Hoy: cobro manual + voucher last4/auth |
| Impresión ticket en terminal | **Falta** | `print_on_terminal` |

## C. Orden recomendado de trabajo

1. Alta cuenta + RFC + liquidación bancaria  
2. Crear app → activar credenciales prod → Access Token  
3. Webhooks: Payments (+ Order si Point)  
4. Poner secrets en VPS → verificar `payments/config`  
5. Compra test $50 + QR + reembolso  
6. Comprar Point → modo PDV → cablear Orders en taquilla  
7. Medición de calidad MP  

Manual paso a paso credenciales: `docs/Manual-Mercado-Pago-Credenciales.pdf`  
Research Point: `docs/research/MERCADO-PAGO-POINT.md`
