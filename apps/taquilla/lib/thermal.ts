/** ESC/POS + Web Serial thermal printer adapter */

export type PrintErrorCode =
  | 'SERIAL_UNSUPPORTED'
  | 'PORT_MISSING'
  | 'PORT_NOT_WRITABLE'
  | 'WRITE_FAILED'
  | 'POPUP_BLOCKED'
  | 'PRINT_WINDOW_FAILED'
  | 'CONNECT_FAILED'
  | 'CONNECT_CANCELLED';

export class PrintError extends Error {
  readonly code: PrintErrorCode;
  readonly cause?: unknown;

  constructor(code: PrintErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'PrintError';
    this.code = code;
    this.cause = cause;
  }
}

export interface PrintResult {
  ok: boolean;
  error?: string;
  code?: PrintErrorCode;
}

export function buildEscPosReceipt(lines: string[]): string {
  const ESC = '\x1b';
  const GS = '\x1d';
  const init = `${ESC}@`;
  const center = `${ESC}a\x01`;
  const left = `${ESC}a\x00`;
  const boldOn = `${ESC}E\x01`;
  const boldOff = `${ESC}E\x00`;
  const cut = `${GS}V\x00`;
  const body = lines.join('\n');
  return `${init}${center}${boldOn}PUMPKIN ZONE${boldOff}\n${left}${body}\n\n${cut}`;
}

/** Cash drawer kick (pin 2, 50ms on / 50ms off) */
export function buildDrawerKick(): string {
  const ESC = '\x1b';
  return `${ESC}p\x00\x19\x19`;
}

/** Impresión por ventana emergente (fallback). Legacy: void, silencio si popup bloqueado. */
export function printEscPos(text: string): void {
  void printEscPosDetailed(text);
}

/** Misma vía que `printEscPos`, con resultado tipado. */
export function printEscPosDetailed(text: string): PrintResult {
  if (typeof window === 'undefined') {
    return { ok: false, code: 'PRINT_WINDOW_FAILED', error: 'Ventana no disponible' };
  }
  let w: Window | null = null;
  try {
    w = window.open('', '_blank', 'width=320,height=480');
  } catch (cause) {
    return {
      ok: false,
      code: 'POPUP_BLOCKED',
      error: cause instanceof Error ? cause.message : 'No se pudo abrir la ventana de impresión',
    };
  }
  if (!w) {
    return {
      ok: false,
      code: 'POPUP_BLOCKED',
      error: 'Ventana de impresión bloqueada por el navegador. Permite popups para esta terminal.',
    };
  }
  try {
    w.document.write(
      `<pre style="font-family:monospace;font-size:12px">${text.replace(/[\x00-\x1f]/g, '')}</pre>`,
    );
    w.document.close();
    w.focus();
    w.print();
    w.close();
    return { ok: true };
  } catch (cause) {
    try {
      w.close();
    } catch {
      // ignore
    }
    return {
      ok: false,
      code: 'PRINT_WINDOW_FAILED',
      error: cause instanceof Error ? cause.message : 'Error al imprimir en ventana emergente',
    };
  }
}

/** Lanza `PrintError` si la impresión por popup falla. */
export function printEscPosSafe(text: string): void {
  const result = printEscPosDetailed(text);
  if (!result.ok) {
    throw new PrintError(result.code ?? 'PRINT_WINDOW_FAILED', result.error ?? 'Error de impresión');
  }
}

type SerialPortLike = {
  open: (opts: { baudRate: number }) => Promise<void>;
  writable: WritableStream<Uint8Array> | null;
  close: () => Promise<void>;
};

declare global {
  interface Navigator {
    serial?: {
      requestPort: () => Promise<SerialPortLike>;
      getPorts: () => Promise<SerialPortLike[]>;
    };
  }
}

const PORT_BAUD_KEY = 'boletera_serial_baud';

type WindowWithPort = Window & { __boleteraPort?: SerialPortLike };

function getWindowPortHolder(): WindowWithPort | null {
  if (typeof window === 'undefined') return null;
  return window as WindowWithPort;
}

export async function connectSerialPrinter(): Promise<boolean> {
  const result = await connectSerialPrinterDetailed();
  return result.ok;
}

export async function connectSerialPrinterDetailed(): Promise<PrintResult> {
  if (typeof navigator === 'undefined' || !navigator.serial) {
    return {
      ok: false,
      code: 'SERIAL_UNSUPPORTED',
      error: 'Web Serial no está disponible en este navegador. Usa Chrome/Edge en la terminal POS.',
    };
  }
  try {
    const port = await navigator.serial.requestPort();
    const baud = Number(
      typeof localStorage !== 'undefined' ? localStorage.getItem(PORT_BAUD_KEY) || 9600 : 9600,
    );
    await port.open({ baudRate: Number.isFinite(baud) && baud > 0 ? baud : 9600 });
    const holder = getWindowPortHolder();
    if (holder) holder.__boleteraPort = port;
    return { ok: true };
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : 'No se pudo conectar la impresora';
    // El usuario canceló el picker de puertos: no es un fallo de hardware.
    const cancelled =
      (cause instanceof DOMException && cause.name === 'NotFoundError') ||
      /cancel|denied|abort/i.test(msg);
    return {
      ok: false,
      code: cancelled ? 'CONNECT_CANCELLED' : 'CONNECT_FAILED',
      error: cancelled ? 'Conexión de impresora cancelada' : msg,
    };
  }
}

export function getSerialPort(): SerialPortLike | null {
  return getWindowPortHolder()?.__boleteraPort ?? null;
}

/** Legacy: boolean. Preferir `printViaSerialDetailed` o `printViaSerialSafe` en código nuevo. */
export async function printViaSerial(text: string, kickDrawer = true): Promise<boolean> {
  const result = await printViaSerialDetailed(text, kickDrawer);
  return result.ok;
}

export async function printViaSerialDetailed(text: string, kickDrawer = true): Promise<PrintResult> {
  if (typeof navigator !== 'undefined' && !navigator.serial) {
    return {
      ok: false,
      code: 'SERIAL_UNSUPPORTED',
      error: 'Web Serial no está disponible en este navegador',
    };
  }

  const port = getSerialPort();
  if (!port) {
    return {
      ok: false,
      code: 'PORT_MISSING',
      error: 'No hay impresora serial conectada. Conéctala desde Ajustes.',
    };
  }
  if (!port.writable) {
    return {
      ok: false,
      code: 'PORT_NOT_WRITABLE',
      error: 'El puerto serial no está listo para escribir. Reconecta la impresora.',
    };
  }

  let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  try {
    writer = port.writable.getWriter();
    const encoder = new TextEncoder();
    let payload = text;
    if (kickDrawer) payload += buildDrawerKick();
    await writer.write(encoder.encode(payload));
    return { ok: true };
  } catch (cause) {
    return {
      ok: false,
      code: 'WRITE_FAILED',
      error: cause instanceof Error ? cause.message : 'Error al escribir en la impresora serial',
    };
  } finally {
    try {
      writer?.releaseLock();
    } catch {
      // El lock puede ya haberse liberado si el stream se cerró.
    }
  }
}

/** Lanza `PrintError` tipado si la impresión serial falla. */
export async function printViaSerialSafe(text: string, kickDrawer = true): Promise<void> {
  const result = await printViaSerialDetailed(text, kickDrawer);
  if (!result.ok) {
    throw new PrintError(result.code ?? 'WRITE_FAILED', result.error ?? 'Error de impresión serial');
  }
}

/**
 * Envía ESC/POS crudo (`Uint8Array`) por serial. Es la vía para trabajos
 * construidos con `escpos.ts` — el QR nativo y los acentos CP850 NO
 * sobreviven el paso por string + TextEncoder de `printViaSerialDetailed`.
 */
export async function printBytesViaSerialDetailed(bytes: Uint8Array): Promise<PrintResult> {
  if (typeof navigator !== 'undefined' && !navigator.serial) {
    return {
      ok: false,
      code: 'SERIAL_UNSUPPORTED',
      error: 'Web Serial no está disponible en este navegador',
    };
  }

  const port = getSerialPort();
  if (!port) {
    return {
      ok: false,
      code: 'PORT_MISSING',
      error: 'No hay impresora serial conectada. Conéctala desde Ajustes.',
    };
  }
  if (!port.writable) {
    return {
      ok: false,
      code: 'PORT_NOT_WRITABLE',
      error: 'El puerto serial no está listo para escribir. Reconecta la impresora.',
    };
  }

  let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  try {
    writer = port.writable.getWriter();
    await writer.write(bytes);
    return { ok: true };
  } catch (cause) {
    return {
      ok: false,
      code: 'WRITE_FAILED',
      error: cause instanceof Error ? cause.message : 'Error al escribir en la impresora serial',
    };
  } finally {
    try {
      writer?.releaseLock();
    } catch {
      // El lock puede ya haberse liberado si el stream se cerró.
    }
  }
}

const BRIDGE_URL_KEY = 'boletera_print_bridge';

/**
 * URL del puente de impresión local (tools/print-bridge). Vacío = deshabilitado.
 * Se configura desde Ajustes; típicamente http://127.0.0.1:9631.
 */
export function getBridgeUrl(): string {
  if (typeof localStorage === 'undefined') return '';
  return (localStorage.getItem(BRIDGE_URL_KEY) ?? '').trim().replace(/\/$/, '');
}

export function setBridgeUrl(url: string): void {
  if (typeof localStorage === 'undefined') return;
  const clean = url.trim().replace(/\/$/, '');
  if (clean) localStorage.setItem(BRIDGE_URL_KEY, clean);
  else localStorage.removeItem(BRIDGE_URL_KEY);
}

/**
 * Manda el trabajo al puente local, que lo reenvía al puerto RAW 9100 de la
 * impresora Ethernet. Es la vía para las Epson USB/Ethernet que Web Serial
 * no puede ver.
 */
export async function printViaBridgeDetailed(bytes: Uint8Array): Promise<PrintResult> {
  const base = getBridgeUrl();
  if (!base) {
    return { ok: false, code: 'PORT_MISSING', error: 'Puente de impresión no configurado' };
  }
  try {
    const res = await fetch(`${base}/print`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      // .slice() garantiza un ArrayBuffer exacto y propio (TS: BodyInit).
      body: bytes.slice().buffer as ArrayBuffer,
      signal: AbortSignal.timeout(12_000),
    });
    const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (res.ok && data?.ok) return { ok: true };
    return {
      ok: false,
      code: 'WRITE_FAILED',
      error: data?.error ?? `Puente respondió ${res.status}`,
    };
  } catch (cause) {
    return {
      ok: false,
      code: 'WRITE_FAILED',
      error:
        cause instanceof Error
          ? `Puente inaccesible: ${cause.message}`
          : 'Puente de impresión inaccesible',
    };
  }
}

/** Prueba de conectividad puente → impresora. Para el botón de Ajustes. */
export async function probeBridge(): Promise<{ ok: boolean; reachable: boolean; error?: string }> {
  const base = getBridgeUrl();
  if (!base) return { ok: false, reachable: false, error: 'Sin URL de puente' };
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(4000) });
    const data = (await res.json()) as { ok?: boolean; reachable?: boolean };
    return { ok: Boolean(data?.ok), reachable: Boolean(data?.reachable) };
  } catch (cause) {
    return {
      ok: false,
      reachable: false,
      error: cause instanceof Error ? cause.message : 'Sin respuesta',
    };
  }
}

/**
 * Imprime un trabajo de bytes intentando cada transporte en orden:
 * serial (Web Serial) → puente local (Ethernet 9100) → popup en texto plano.
 * El popup no puede renderizar el QR (es firmware de impresora), así que
 * `fallbackText` debe traer el código en texto — sigue siendo escaneable
 * como entrada manual en puerta.
 */
export async function printJobSafe(
  bytes: Uint8Array,
  fallbackText: string,
): Promise<'serial' | 'bridge' | 'popup'> {
  const serial = await printBytesViaSerialDetailed(bytes);
  if (serial.ok) return 'serial';

  const bridge = await printViaBridgeDetailed(bytes);
  if (bridge.ok) return 'bridge';

  const soft =
    serial.code === 'SERIAL_UNSUPPORTED' ||
    serial.code === 'PORT_MISSING' ||
    serial.code === 'PORT_NOT_WRITABLE';

  const popup = printEscPosDetailed(fallbackText);
  if (popup.ok) return 'popup';

  const primary = soft ? popup : serial;
  throw new PrintError(
    primary.code ?? 'WRITE_FAILED',
    primary.error ?? 'No se pudo imprimir el trabajo',
  );
}

/**
 * Intenta serial; si falla por puerto ausente/no writable, cae a popup.
 * Lanza `PrintError` sólo si ambas vías fallan.
 */
export async function printReceiptSafe(text: string, kickDrawer = true): Promise<'serial' | 'popup'> {
  const serial = await printViaSerialDetailed(text, kickDrawer);
  if (serial.ok) return 'serial';

  // Si serial no está soportado o no hay puerto, el fallback popup es esperado.
  const soft =
    serial.code === 'SERIAL_UNSUPPORTED' ||
    serial.code === 'PORT_MISSING' ||
    serial.code === 'PORT_NOT_WRITABLE';

  const popup = printEscPosDetailed(text);
  if (popup.ok) return 'popup';

  const primary = soft ? popup : serial;
  throw new PrintError(
    primary.code ?? 'WRITE_FAILED',
    primary.error ?? 'No se pudo imprimir el ticket',
  );
}

export function isSerialSupported(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.serial);
}
