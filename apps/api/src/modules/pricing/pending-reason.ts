import {
  APPLIED_REASON_PREFIX,
  PENDING_REASON_PREFIX,
  REJECTED_REASON_PREFIX,
  type PendingReasonPayload,
} from './pricing.types';

export function encodePendingReason(payload: PendingReasonPayload): string {
  return `${PENDING_REASON_PREFIX}${JSON.stringify(payload)}`;
}

export function encodeRejectedReason(payload: PendingReasonPayload, note?: string): string {
  const body = { ...payload, status: 'rejected' as const, note: note?.slice(0, 500) };
  return `${REJECTED_REASON_PREFIX}${JSON.stringify(body)}`;
}

export function encodeAppliedReason(explanation: string): string {
  return `${APPLIED_REASON_PREFIX}${explanation.slice(0, 400)}`;
}

export function parsePendingReason(reason: string): PendingReasonPayload | undefined {
  if (!reason.startsWith(PENDING_REASON_PREFIX)) return undefined;
  try {
    const raw = JSON.parse(reason.slice(PENDING_REASON_PREFIX.length)) as PendingReasonPayload;
    if (raw?.v !== 1) return undefined;
    return raw;
  } catch {
    return undefined;
  }
}

export function isPendingReason(reason: string): boolean {
  return reason.startsWith(PENDING_REASON_PREFIX);
}
