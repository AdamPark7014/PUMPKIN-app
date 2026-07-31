export type JobName =
  | 'release-expired-holds'
  | 'process-pending-payouts'
  | 'reconcile-banorte-spei'
  | 'schedule-tick';

export interface JobPayload {
  readonly name: JobName;
  readonly correlationId: string;
  readonly enqueuedAt: string;
  readonly tickBucket?: string;
  readonly failedAt?: string;
  readonly failureCode?: string;
  readonly permanent?: boolean;
  readonly attemptsMade?: number;
  readonly sourceJobId?: string;
}
