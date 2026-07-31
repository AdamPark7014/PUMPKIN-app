import type { Job } from 'bull';
import { prisma } from '@boletera/database';
import { config, validateConfig } from './config';
import { ConcurrencyGate } from './concurrency';
import { createHealthServer } from './health';
import { isPermanentError } from './errors';
import {
  processPendingPayouts,
  reconcileBanorteSpei,
  releaseExpiredHolds,
  runScheduleTick,
} from './jobs/handlers';
import { logger } from './logger';
import { metrics } from './metrics';
import { createQueues, isRedisReady } from './queues';
import {
  moveToDeadLetter,
  wrapHandler,
  type JobName,
  type JobPayload,
} from './runner';
import { startScheduler } from './scheduler';
import { installGracefulShutdown } from './shutdown';

async function checkDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

function singleFlight<T>(check: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    if (!pending) {
      pending = check().finally(() => {
        pending = undefined;
      });
    }
    return pending;
  };
}

async function main(): Promise<void> {
  validateConfig();
  logger.info('worker starting', {
    reason: `autoPayout=${config.autoPayout}`,
    status: config.healthPort,
  });

  const { jobs, dlq } = createQueues();
  const redisReadyCheck = singleFlight(() => isRedisReady(jobs));
  const databaseReadyCheck = singleFlight(checkDatabase);
  const gate = new ConcurrencyGate(config.maxInFlight);

  const handlers: Record<JobName, ReturnType<typeof wrapHandler>> = {
    'release-expired-holds': wrapHandler(
      'release-expired-holds',
      async ({ correlationId }) => {
        await releaseExpiredHolds(correlationId);
      },
      gate,
    ),
    'process-pending-payouts': wrapHandler(
      'process-pending-payouts',
      async ({ correlationId }) => {
        await processPendingPayouts(correlationId);
      },
      gate,
    ),
    'reconcile-banorte-spei': wrapHandler(
      'reconcile-banorte-spei',
      async ({ correlationId }) => {
        await reconcileBanorteSpei(correlationId);
      },
      gate,
    ),
    'schedule-tick': wrapHandler(
      'schedule-tick',
      async ({ correlationId }) => {
        await runScheduleTick(correlationId);
      },
      gate,
    ),
  };

  for (const [name, handler] of Object.entries(handlers) as Array<
    [JobName, (job: Job<JobPayload>) => Promise<void>]
  >) {
    void jobs.process(name, config.concurrency, handler);
  }

  jobs.on('failed', (job: Job<JobPayload> | undefined, err: Error) => {
    if (!job) return;
    const maxAttempts = job.opts.attempts ?? config.jobAttempts;
    const permanent = isPermanentError(err);
    const exhausted = job.attemptsMade >= maxAttempts || permanent;
    if (!exhausted) return;

    void moveToDeadLetter(job, dlq, err).catch((dlqErr: unknown) => {
      logger.error('dead-letter copy failed', {
        job: job.data.name,
        jobId: job.id,
        correlationId: job.data.correlationId,
        reason: dlqErr instanceof Error ? dlqErr.message : String(dlqErr),
      });
    });
  });

  jobs.on('error', (err: Error) => {
    logger.error('queue error', { errorName: err.name, reason: err.message, queue: jobs.name });
  });
  dlq.on('error', (err: Error) => {
    logger.error('dlq error', { errorName: err.name, reason: err.message, queue: dlq.name });
  });

  const [redisReady, databaseReady] = await Promise.all([
    redisReadyCheck(),
    databaseReadyCheck(),
  ]);
  if (!redisReady || !databaseReady) {
    throw new Error(`dependency check failed: redis=${redisReady} database=${databaseReady}`);
  }

  const dlqDepth = singleFlight(async () => {
    const counts = await dlq.getJobCounts();
    return (counts.waiting ?? 0) + (counts.delayed ?? 0) + (counts.failed ?? 0) + (counts.active ?? 0);
  });
  const queueWaiting = singleFlight(async () => {
    const counts = await jobs.getJobCounts();
    return (counts.waiting ?? 0) + (counts.delayed ?? 0) + (counts.active ?? 0);
  });
  const healthServer = await createHealthServer(config.healthPort, {
    redisOk: redisReadyCheck,
    databaseOk: databaseReadyCheck,
    dlqDepth,
    queueWaiting,
  });

  metrics.setReady(true);
  const scheduler = startScheduler(jobs);

  installGracefulShutdown({ jobs, dlq, healthServer, scheduler });
  logger.info('worker ready', {
    reason: `intervalMs=${config.intervalMs}`,
    queue: jobs.name,
  });
}

main().catch((err: unknown) => {
  logger.error('worker boot failed', {
    errorName: err instanceof Error ? err.name : 'Error',
    reason: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
