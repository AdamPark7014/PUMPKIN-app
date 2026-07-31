import Bull from 'bull';
import { config } from './config';
import { createJitterBackoffStrategy } from './backoff';
import type { JobPayload } from './types';

export type WorkerQueue = Bull.Queue<JobPayload>;

const JITTER_STRATEGY = 'jitter';

export function createQueues(): { jobs: WorkerQueue; dlq: WorkerQueue } {
  const common: Bull.QueueOptions = {
    redis: config.redisUrl,
    prefix: config.queuePrefix,
    settings: {
      backoffStrategies: {
        [JITTER_STRATEGY]: createJitterBackoffStrategy(config.backoffBaseMs, config.backoffMaxMs),
      },
    },
    defaultJobOptions: {
      attempts: config.jobAttempts,
      backoff: {
        type: JITTER_STRATEGY,
        delay: config.backoffBaseMs,
      },
      removeOnComplete: true,
      // Keep failed jobs in Redis — Bull failed set is the dead-letter store.
      removeOnFail: false,
    },
  };

  const jobs = new Bull<JobPayload>(config.queueName, common);
  const dlq = new Bull<JobPayload>(config.dlqName, {
    redis: config.redisUrl,
    prefix: config.queuePrefix,
    defaultJobOptions: {
      removeOnComplete: false,
      removeOnFail: false,
    },
  });

  return { jobs, dlq };
}

export async function closeQueues(
  queues: { jobs: WorkerQueue; dlq: WorkerQueue },
  doNotWaitJobs = false,
): Promise<void> {
  await Promise.all([queues.jobs.close(doNotWaitJobs), queues.dlq.close(doNotWaitJobs)]);
}

export async function isRedisReady(queue: WorkerQueue): Promise<boolean> {
  try {
    const client = queue.client;
    if (typeof (client as { ping?: () => Promise<string> }).ping === 'function') {
      const pong = await (client as { ping: () => Promise<string> }).ping();
      return pong === 'PONG' || pong === 'pong';
    }
    await queue.getJobCounts();
    return true;
  } catch {
    return false;
  }
}
