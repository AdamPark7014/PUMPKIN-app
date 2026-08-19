#!/usr/bin/env node
/**
 * Puente de impresión térmica — ESC/POS crudo al puerto 9100.
 *
 * Existe porque Chrome sólo habla con impresoras vía Web Serial, y las Epson
 * TM por USB se presentan como clase impresora (invisibles para el navegador).
 * Este proceso corre en la máquina de la caja y reenvía bytes al puerto RAW
 * 9100 de la impresora Ethernet. La taquilla le manda el mismo `Uint8Array`
 * que mandaría por serial.
 *
 *   node print-bridge.mjs                          # 127.0.0.1:9631 → PRINTER_HOST:9100
 *   PRINTER_HOST=192.168.1.50 node print-bridge.mjs
 *
 * Endpoints:
 *   GET  /health   → { ok, printer, reachable }
 *   POST /print    → cuerpo binario (application/octet-stream) o
 *                    JSON { data: "<base64>" }. Responde { ok } o { ok:false, error }.
 *
 * Seguridad: escucha SOLO en 127.0.0.1. No lo expongas a la red — cualquiera
 * que pueda hacerle POST imprime papel y patea el cajón.
 */
import { createServer } from 'node:http';
import { connect } from 'node:net';

const HOST = process.env.BRIDGE_HOST || '127.0.0.1';
const PORT = Number(process.env.BRIDGE_PORT || 9631);
const PRINTER_HOST = process.env.PRINTER_HOST || '192.168.1.100';
const PRINTER_PORT = Number(process.env.PRINTER_PORT || 9100);
/** La TM-T20III imprime a ~250 mm/s; 10 s cubre el trabajo más largo. */
const PRINT_TIMEOUT_MS = Number(process.env.PRINT_TIMEOUT_MS || 10_000);

/** Manda bytes al puerto RAW y resuelve cuando el socket terminó de escribir. */
function sendToPrinter(bytes) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: PRINTER_HOST, port: PRINTER_PORT });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Timeout de ${PRINT_TIMEOUT_MS} ms hacia la impresora`));
    }, PRINT_TIMEOUT_MS);

    socket.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    socket.on('connect', () => {
      socket.end(bytes, () => {
        clearTimeout(timer);
        resolve();
      });
    });
  });
}

function probePrinter() {
  return new Promise((resolve) => {
    const socket = connect({ host: PRINTER_HOST, port: PRINTER_PORT });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 1500);
    socket.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    socket.on('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1_000_000) {
        reject(new Error('Trabajo de impresión demasiado grande'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json',
    // La taquilla corre en localhost:3002 (u otro origen local): CORS abierto
    // es aceptable porque el servicio sólo escucha en loopback.
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    json(res, 204, {});
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    const reachable = await probePrinter();
    json(res, 200, {
      ok: true,
      printer: `${PRINTER_HOST}:${PRINTER_PORT}`,
      reachable,
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/print') {
    try {
      const raw = await readBody(req);
      let bytes = raw;
      const type = req.headers['content-type'] ?? '';
      if (type.includes('application/json')) {
        const parsed = JSON.parse(raw.toString('utf8'));
        if (typeof parsed?.data !== 'string') {
          json(res, 400, { ok: false, error: 'JSON sin campo data (base64)' });
          return;
        }
        bytes = Buffer.from(parsed.data, 'base64');
      }
      if (!bytes.length) {
        json(res, 400, { ok: false, error: 'Trabajo vacío' });
        return;
      }
      await sendToPrinter(bytes);
      json(res, 200, { ok: true, bytes: bytes.length });
    } catch (err) {
      json(res, 502, {
        ok: false,
        error: err instanceof Error ? err.message : 'Error al imprimir',
      });
    }
    return;
  }

  json(res, 404, { ok: false, error: 'Usa GET /health o POST /print' });
});

server.listen(PORT, HOST, () => {
  console.log(`print-bridge en http://${HOST}:${PORT} → impresora ${PRINTER_HOST}:${PRINTER_PORT}`);
  console.log('GET /health para probar conectividad; POST /print para imprimir.');
});
