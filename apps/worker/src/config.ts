import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

function intEnv(name: string, fallback: number, minimum = 1): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(n) || n < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}`);
  }
  return n;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  throw new Error(`${name} must be true, false, 1, or 0`);
}

export const config = {
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  apiInternalUrl: process.env.API_INTERNAL_URL || 'http://localhost:4000/api/v1',
  internalApiSecret: process.env.INTERNAL_API_SECRET || process.env.JWT_SECRET || '',
  autoPayout: boolEnv('WORKER_AUTO_PAYOUT', false),
  intervalMs: intEnv('WORKER_INTERVAL_MS', 30_000),
  concurrency: intEnv('WORKER_CONCURRENCY', 2),
  maxInFlight: intEnv('WORKER_MAX_IN_FLIGHT', 4),
  jobAttempts: intEnv('WORKER_JOB_ATTEMPTS', 5),
  backoffBaseMs: intEnv('WORKER_BACKOFF_BASE_MS', 2_000),
  backoffMaxMs: intEnv('WORKER_BACKOFF_MAX_MS', 60_000),
  internalRequestTimeoutMs: intEnv('WORKER_INTERNAL_REQUEST_TIMEOUT_MS', 15_000),
  healthPort: intEnv('WORKER_HEALTH_PORT', 4100),
  healthCheckTimeoutMs: intEnv('WORKER_HEALTH_CHECK_TIMEOUT_MS', 2_000),
  readinessMaxQueueDepth: intEnv('WORKER_READINESS_MAX_QUEUE_DEPTH', 10_000),
  shutdownGraceMs: intEnv('WORKER_SHUTDOWN_GRACE_MS', 25_000),
  queuePrefix: process.env.WORKER_QUEUE_PREFIX || 'ticketos',
  queueName: process.env.WORKER_QUEUE_NAME || 'worker-jobs',
  dlqName: process.env.WORKER_DLQ_NAME || 'worker-dlq',
} as const;

export type WorkerConfig = typeof config;

export function validateConfig(value: WorkerConfig = config): void {
  if (!value.internalApiSecret) {
    throw new Error('INTERNAL_API_SECRET or JWT_SECRET is required');
  }
  if (value.backoffMaxMs < value.backoffBaseMs) {
    throw new Error('WORKER_BACKOFF_MAX_MS must be >= WORKER_BACKOFF_BASE_MS');
  }
  if (value.maxInFlight < 1 || value.concurrency < 1) {
    throw new Error('worker concurrency limits must be >= 1');
  }
}
