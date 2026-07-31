import { randomUUID } from 'crypto';

export function createCorrelationId(): string {
  return randomUUID();
}

export function correlationHeaders(
  correlationId: string,
  secret: string,
  idempotencyKey?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Correlation-Id': correlationId,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (secret) {
    headers['X-Internal-Secret'] = secret;
  }
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }
  return headers;
}
