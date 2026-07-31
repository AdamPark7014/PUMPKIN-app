import type { Job } from 'bull';
import type { WorkerQueue } from './queues';
import { createCorrelationId } from './correlation';
import { isPermanentError, toWorkerError } from './errors';
import { logger } from './logger';
import { metrics } from './metrics';
import type { ConcurrencyGate } from './concurrency';
import type { JobName, JobPayload } from './types';

export type { JobName, JobPayload } from './types';

export type JobHandler = (ctx: { correlationId: string; attempt: number }) => Promise<void>;

export function buildPayload(name: JobName, correlationId?: string): JobPayload {
  return {
    name,
    correlationId: correlationId ?? createCorrelationId(),
    enqueuedAt: new Date().toISOString(),
  };
}

export function wrapHandler(
  name: JobName,
  handler: JobHandler,
  gate: ConcurrencyGate,
): (job: Job<JobPayload>) => Promise<void> {
  return async (job: Job<JobPayload>) => {
    const correlationId = job.data.correlationId || createCorrelationId();
    const attempt = job.attemptsMade + 1;
    const started = Date.now();

    metrics.begin();
    await gate.acquire();
    metrics.recordAttempt(name, attempt);
    logger.info('job start', {
      job: name,
      jobId: job.id,
      correlationId,
      attempt,
    });

    try {
      await handler({ correlationId, attempt });
      const durationMs = Date.now() - started;
      metrics.recordSuccess(name, durationMs);
      logger.info('job success', {
        job: name,
        jobId: job.id,
        correlationId,
        attempt,
        durationMs,
      });
    } catch (err) {
      const classified = toWorkerError(err);
      const durationMs = Date.now() - started;
      const permanent = isPermanentError(classified);
      metrics.recordFailure(name, durationMs, permanent);
      logger.error('job failure', {
        job: name,
        jobId: job.id,
        correlationId,
        attempt,
        durationMs,
        code: classified.code,
        errorName: classified.name,
        permanent,
        reason: classified.message,
      });

      if (permanent) {
        // Prevent further Bull retries; job lands in failed set (DLQ).
        await job.discard();
      }
      throw classified;
    } finally {
      metrics.end();
      gate.release();
    }
  };
}

export async function moveToDeadLetter(
  job: Job<JobPayload>,
  dlq: WorkerQueue,
  err: unknown,
): Promise<void> {
  const classified = toWorkerError(err);
  try {
    await dlq.add(
      'dead-letter',
      {
        ...job.data,
        correlationId: job.data.correlationId || createCorrelationId(),
        failedAt: new Date().toISOString(),
        failureCode: classified.code,
        permanent: isPermanentError(classified),
        attemptsMade: job.attemptsMade,
        sourceJobId: String(job.id),
      },
      {
        jobId: `dlq:${String(job.id)}:${job.data.name}`,
        removeOnComplete: false,
        removeOnFail: false,
      },
    );
  } catch (addErr) {
    const message = addErr instanceof Error ? addErr.message : String(addErr);
    if (/already exists/i.test(message)) {
      return;
    }
    throw addErr;
  }
  metrics.recordDeadLetter(job.data.name);
  logger.warn('job dead-lettered', {
    job: job.data.name,
    jobId: job.id,
    correlationId: job.data.correlationId,
    code: classified.code,
    permanent: isPermanentError(classified),
    reason: classified.message,
    queue: dlq.name,
  });
}
