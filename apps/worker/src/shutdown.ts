import type * as http from 'http';
import { prisma } from '@boletera/database';
import { logger } from './logger';
import { metrics } from './metrics';
import { closeQueues, type WorkerQueue } from './queues';
import { closeHttpServer } from './health';
import { config } from './config';

export interface ShutdownTargets {
  readonly jobs: WorkerQueue;
  readonly dlq: WorkerQueue;
  readonly healthServer: http.Server;
  readonly scheduler: NodeJS.Timeout;
}

export function installGracefulShutdown(targets: ShutdownTargets): void {
  let shuttingDown = false;

  const run = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    metrics.setShuttingDown(true);
    metrics.setReady(false);
    logger.info('graceful shutdown started', { reason: signal });

    clearInterval(targets.scheduler);
    try {
      await targets.jobs.pause(true, true);
    } catch (err) {
      logger.warn('queue pause failed', {
        reason: err instanceof Error ? err.message : String(err),
      });
    }

    const deadline = Date.now() + config.shutdownGraceMs;
    while (metrics.getInFlight() > 0 && Date.now() < deadline) {
      await sleep(200);
    }

    const graceElapsed = metrics.getInFlight() > 0;
    if (graceElapsed) {
      logger.warn('shutdown grace elapsed with in-flight jobs', {
        reason: 'grace_timeout',
      });
    }

    try {
      await closeHttpServer(targets.healthServer);
    } catch (err) {
      logger.warn('health server close failed', {
        reason: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      await closeQueues({ jobs: targets.jobs, dlq: targets.dlq }, graceElapsed);
    } catch (err) {
      logger.warn('queue close failed', {
        reason: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      await prisma.$disconnect();
    } catch (err) {
      logger.warn('prisma disconnect failed', {
        reason: err instanceof Error ? err.message : String(err),
      });
    }

    logger.info('graceful shutdown complete', { reason: signal });
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void run('SIGTERM');
  });
  process.on('SIGINT', () => {
    void run('SIGINT');
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
