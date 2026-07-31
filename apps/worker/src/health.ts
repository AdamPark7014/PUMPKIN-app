import * as http from 'http';
import { config } from './config';
import { metrics } from './metrics';
import { logger } from './logger';

export interface HealthDeps {
  readonly redisOk: () => Promise<boolean>;
  readonly databaseOk: () => Promise<boolean>;
  readonly dlqDepth: () => Promise<number>;
  readonly queueWaiting: () => Promise<number>;
}

export async function createHealthServer(port: number, deps: HealthDeps): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    void handle(req, res, deps);
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error): void => reject(err);
    server.once('error', onError);
    server.listen(port, () => {
      server.off('error', onError);
      resolve();
    });
  });
  logger.info('health server listening', { status: port });
  return server;
}

async function handle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: HealthDeps,
): Promise<void> {
  const url = req.url?.split('?')[0] ?? '/';

  try {
    if (url === '/health' || url === '/healthz') {
      json(res, 200, { status: 'ok', service: 'worker' });
      return;
    }

    if (url === '/ready' || url === '/readyz') {
      const [redisOk, databaseOk, queueDepth] = await Promise.all([
        withTimeout(deps.redisOk(), config.healthCheckTimeoutMs, false),
        withTimeout(deps.databaseOk(), config.healthCheckTimeoutMs, false),
        withTimeout(deps.queueWaiting(), config.healthCheckTimeoutMs, Number.MAX_SAFE_INTEGER),
      ]);
      const acceptingWork = queueDepth <= config.readinessMaxQueueDepth;
      const ready =
        metrics.isReady() &&
        redisOk &&
        databaseOk &&
        acceptingWork &&
        !metrics.isShuttingDown();
      json(res, ready ? 200 : 503, {
        status: ready ? 'ready' : 'not_ready',
        redis: redisOk ? 'up' : 'down',
        database: databaseOk ? 'up' : 'down',
        queueDepth,
        acceptingWork,
        shuttingDown: metrics.isShuttingDown(),
        inFlight: metrics.getInFlight(),
      });
      return;
    }

    if (url === '/metrics') {
      const snap = metrics.snapshot();
      const [dlq, waiting] = await Promise.all([deps.dlqDepth(), deps.queueWaiting()]);
      json(res, 200, { ...snap, dlqDepth: dlq, queueWaiting: waiting });
      return;
    }

    json(res, 404, { status: 'not_found' });
  } catch (err) {
    logger.error('health handler failed', {
      errorName: err instanceof Error ? err.name : 'Error',
      reason: err instanceof Error ? err.message : String(err),
    });
    json(res, 500, { status: 'error' });
  }
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function closeHttpServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}
