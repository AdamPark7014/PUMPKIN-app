import {
  clearCloseIntent,
  getCloseIntent,
  getSessionId,
  type CloseIntentState,
} from '@/lib/pos';

export type CloseRecoveryState =
  | { kind: 'none' }
  | { kind: 'already_sent'; intent: CloseIntentState }
  | { kind: 'retry'; intent: CloseIntentState };

/**
 * Classify a durable close intent against the local session key.
 * - Session gone + intent present ⇒ close likely already accepted server-side.
 * - Session still matches ⇒ offer "Reintentar cierre".
 */
export function classifyCloseRecovery(
  intent: CloseIntentState | null = getCloseIntent(),
  sessionId: string | null = getSessionId(),
): CloseRecoveryState {
  if (!intent) return { kind: 'none' };
  if (!sessionId || sessionId !== intent.sessionId) {
    return { kind: 'already_sent', intent };
  }
  return { kind: 'retry', intent };
}

export function acknowledgeAlreadySentClose(): void {
  clearCloseIntent();
}

export { clearCloseIntent, getCloseIntent };
