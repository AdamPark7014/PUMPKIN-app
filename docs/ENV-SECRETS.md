# Secretos de entorno

Cómo generar y operar los secretos que la plataforma valida en tiempo de ejecución.
Todo lo que sigue está verificado contra el código de este repositorio.

> **Nunca escribas un secreto real en `.env.example`, en `docker-compose.yml`, en la
> documentación ni en un issue.** Los valores `REPLACE_ME_*` de `.env.example` son
> marcadores: se sustituyen en tu `.env` local (ignorado por git) o en el gestor de
> secretos del entorno.

---

## TICKET_QR_SECRET

Clave HMAC con la que se firman los códigos QR de los boletos. La firma rota cada
15 segundos (`ROTATION_SECONDS` en `packages/crypto/src/index.ts`) y al verificar se
aceptan la ventana actual, la anterior y la siguiente para tolerar desfase de reloj.

| | |
|---|---|
| Longitud mínima | **32 caracteres** (`MIN_SECRET_LENGTH`) |
| Dónde se valida | `assertTicketSecret()` en `packages/crypto/src/index.ts` |
| Cuándo se valida | Al **firmar o verificar** un QR, no al arrancar el proceso |
| Si falta | La API cae a `JWT_SECRET` (ver [Fallback a JWT_SECRET](#fallback-a-jwt_secret)) |

### Cómo generar uno

Forma canónica, la misma que sugiere el mensaje de error del paquete:

```bash
openssl rand -hex 32
```

Devuelve 64 caracteres hexadecimales (32 bytes de entropía), muy por encima del mínimo.
En Windows, `openssl` viene con Git for Windows (Git Bash) o con WSL. Si no lo tienes en
el `PATH`, cualquiera de estas alternativas produce un valor equivalente:

```powershell
# PowerShell 7+ nativo
$bytes = [byte[]]::new(32)
[System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
[System.BitConverter]::ToString($bytes).Replace('-', '').ToLower()
```

```powershell
# Node (ya disponible en el monorepo; sirve también en Windows PowerShell 5.1)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copia la salida a tu `.env` local. No la pegues en el repositorio ni la compartas por chat.

```dotenv
TICKET_QR_SECRET=<64 caracteres hex generados arriba>
```

### Por qué falla un secreto corto

`packages/crypto` no proporciona ningún secreto por defecto: si el valor recibido no es
una cadena de al menos 32 caracteres, lanza y corta la operación.

```
TICKET_QR_SECRET must be at least 32 characters. Generate one with: openssl rand -hex 32
```

Esa excepción se dispara en `signTicketPayload()`, `verifyTicketSignature()` y
`buildQrPayload()`, es decir **en la petición**, no en el arranque. Consecuencia práctica:
con un secreto corto la API levanta sin quejarse y luego devuelve error 500 al emitir el QR
de un boleto, al generar el PDF de la orden y al escanear en el acceso. La validación de
`JWT_SECRET` sí es de boot (`apps/api/src/modules/auth/jwt-secret.ts`); la de
`TICKET_QR_SECRET` no. No interpretes "arrancó bien" como "el secreto es válido".

### Fallback a JWT_SECRET

Los consumidores resuelven el secreto así:

- `apps/api/src/modules/orders/orders.service.ts` y
  `apps/api/src/modules/access/access.service.ts` → `process.env.TICKET_QR_SECRET || requireJwtSecret()`
- `apps/api/src/modules/notification/ticket-pdf.service.ts` y
  `apps/api/src/modules/notification/notification.processor.ts` → `config.get('TICKET_QR_SECRET') ?? config.get('JWT_SECRET')`

El fallback **solo evita la variable ausente; no relaja el mínimo de 32**. Si se acaba
usando `JWT_SECRET` y este es corto, `assertTicketSecret()` lanza igual.

| `TICKET_QR_SECRET` | Qué ocurre |
|---|---|
| Sin definir | Se usa `JWT_SECRET`. Funciona solo si tiene ≥32 caracteres |
| Vacío (`TICKET_QR_SECRET=`) | **Incoherente entre módulos**: con `\|\|` (órdenes, acceso) cae a `JWT_SECRET` y funciona; con `??` (PDF, notificaciones) la cadena vacía no es nula, así que gana al fallback y aborta con `Neither TICKET_QR_SECRET nor JWT_SECRET is configured.` aunque `JWT_SECRET` sí esté puesto. No lo dejes vacío: o lo defines bien o lo omites |
| 1–31 caracteres | Falla siempre. El fallback **no** se aplica: el valor corto ya es "truthy" y llega tal cual a `packages/crypto` |
| ≥32 caracteres | Correcto |

Hay además un matiz de unidades: `requireJwtSecret()` mide **bytes UTF-8**
(`Buffer.byteLength`) y `assertTicketSecret()` mide **caracteres** (`String.length`). Un
`JWT_SECRET` con acentos o emojis puede superar los 32 bytes y quedarse por debajo de los
32 caracteres, con lo que pasa el arranque de la API y revienta al firmar el QR. Es otra
razón para definir `TICKET_QR_SECRET` de forma explícita en vez de apoyarse en el fallback.

### Rotación

Cambiar `TICKET_QR_SECRET` invalida toda firma emitida con el valor anterior. Los QR se
firman en el momento de emitirse y caducan por sí solos en cuestión de segundos, así que
el impacto es acotado, pero ten en cuenta que **los PDF de boleto ya enviados por correo
llevan el payload embebido** (`ticket-pdf.service.ts` incrusta el resultado de
`buildQrPayload`) y dejarán de verificar. Rota fuera de horario de evento y despliega el
nuevo valor en todas las instancias de la API a la vez: quien firma y quien verifica es el
mismo servicio, así que dos réplicas con secretos distintos rechazan mutuamente sus QR.

### Dónde interviene el secreto

| Archivo | Uso |
|---|---|
| `packages/crypto/src/index.ts` | Firma, verificación y validación de longitud |
| `apps/api/src/modules/orders/orders.service.ts` | QR de los boletos de una orden completada |
| `apps/api/src/modules/access/access.service.ts` | Emisión y verificación de QR de acceso al escanear |
| `apps/api/src/modules/notification/ticket-pdf.service.ts` | QR embebido en el PDF del boleto |
| `apps/api/src/modules/notification/notification.processor.ts` | QR de los correos de boleto |

---

## JWT_SECRET

Firma los tokens de sesión y, como se explica arriba, es el fallback del QR.
`requireJwtSecret()` lo rechaza **en el arranque** cuando:

- falta,
- mide menos de 32 bytes UTF-8, o
- empieza por `change-me`, `secret` o `your-super-secret` (comparación sin distinguir
  mayúsculas), para que ningún valor de plantilla llegue a producción.

Se genera igual que `TICKET_QR_SECRET`: `openssl rand -hex 32`.

---

## Dónde se inyectan estos valores

- **Local / host**: copia `.env.example` a `.env` en la raíz del monorepo y sustituye los
  `REPLACE_ME_*`.
- **Docker Compose**: `docker-compose.yml` inyecta `TICKET_QR_SECRET` y `JWT_SECRET` en el
  servicio `api` tomándolos del `.env` de la raíz. Los valores por defecto del compose son
  marcadores de desarrollo, no secretos utilizables en producción. El servicio `worker` no
  necesita `TICKET_QR_SECRET`: no firma ni verifica QR.
- **CI**: `.github/workflows/ci.yml` define `JWT_SECRET` con un valor de pruebas y **no**
  define `TICKET_QR_SECRET`, de modo que los jobs ejercitan deliberadamente la ruta de
  fallback. Los tests unitarios de `packages/crypto` usan sus propias constantes y no leen
  el entorno.
- **Producción**: gestor de secretos del proveedor. Un secreto distinto por entorno y
  nunca reutilizado entre `JWT_SECRET` y `TICKET_QR_SECRET`.

## Checklist antes de desplegar

1. `TICKET_QR_SECRET` definido explícitamente, ≥32 caracteres, generado con
   `openssl rand -hex 32`.
2. `JWT_SECRET` ≥32 bytes y sin prefijo de plantilla.
3. Ambos distintos entre sí y distintos por entorno (dev / staging / producción).
4. Todas las réplicas de la API comparten el mismo `TICKET_QR_SECRET`.
5. Ningún `REPLACE_ME_*` sobreviviendo en el `.env` desplegado.
6. Prueba de humo tras el despliegue: emitir el QR de un boleto y escanearlo. Es la única
   forma de comprobar la longitud del secreto, porque la validación no ocurre en el arranque.
