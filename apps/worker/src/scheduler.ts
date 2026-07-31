import type { WorkerQueue } from './queues';
import { buildPayload } from './runner';
import type { JobName } from './types';
import { createCorrelationId } from './correlation';
import { logger } from './logger';
import { metrics } from './metrics';
import { config } from './config';

const JOB_NAMES: readonly JobName[] = [
  'release-expired-holds',
  'process-pending-payouts',
  'reconcile-banorte-spei',
  'schedule-tick',
] as const;

/**
 * Enqueues a tick for each job using a time-bucket jobId for idempotent scheduling
 * (duplicate ticks within the same interval are coalesced by Bull).
 */
export async function enqueueTick(queue: WorkerQueue): Promise<void> {
  if (metrics.isShuttingDown()) return;

  const bucket = Math.floor(Date.now() / config.intervalMs).toString();
  const correlationId = createCorrelationId();

  for (const name of JOB_NAMES) {
    const jobId = `${name}:${bucket}`;
    try {
      await queue.add(
        name,
        { ...buildPayload(name, correlationId), tickBucket: bucket },
        {
          jobId,
          attempts: config.jobAttempts,
          backoff: { type: 'jitter', delay: config.backoffBaseMs },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
    } catch (err) {
      // Bull throws when jobId already exists — expected idempotent coalesce.
      const message = err instanceof Error ? err.message : String(err);
      if (/Job .* already exists|already exists/i.test(message)) {
        continue;
      }
      logger.warn('enqueue tick failed', {
        job: name,
        correlationId,
        reason: message,
      });
    }
  }
}

export function startScheduler(queue: WorkerQueue): NodeJS.Timeout {
  let running = false;
  const run = async (): Promise<void> => {
    if (running || metrics.isShuttingDown()) return;
    running = true;
    try {
      await enqueueTick(queue);
    } finally {
      running = false;
    }
  };

  void run();
  return setInterval(() => {
    void run();
  }, config.intervalMs);
}
