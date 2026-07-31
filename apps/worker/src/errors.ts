export class PermanentError extends Error {
  readonly permanent = true as const;
  readonly code: string;

  constructor(message: string, code = 'PERMANENT') {
    super(message);
    this.name = 'PermanentError';
    this.code = code;
  }
}

export class TransientError extends Error {
  readonly permanent = false as const;
  readonly code: string;

  constructor(message: string, code = 'TRANSIENT') {
    super(message);
    this.name = 'TransientError';
    this.code = code;
  }
}

export function isPermanentError(err: unknown): boolean {
  if (err instanceof PermanentError) return true;
  if (err && typeof err === 'object' && 'permanent' in err && (err as { permanent: unknown }).permanent === true) {
    return true;
  }
  return false;
}

export function classifyHttpStatus(status: number): 'permanent' | 'transient' {
  if (status === 408 || status === 425 || status === 429) return 'transient';
  if (status >= 500) return 'transient';
  if (status >= 400) return 'permanent';
  return 'transient';
}

export function toWorkerError(err: unknown, fallbackCode = 'UNKNOWN'): PermanentError | TransientError {
  if (err instanceof PermanentError || err instanceof TransientError) return err;

  if (err instanceof TypeError && /fetch|network|ECONN|ENOTFOUND/i.test(String(err.message))) {
    return new TransientError(err.message, 'NETWORK');
  }

  if (err && typeof err === 'object') {
    const anyErr = err as { code?: string; message?: string; name?: string };
    const code = anyErr.code ?? fallbackCode;
    const message = anyErr.message ?? String(err);
    if (
      code === 'ECONNREFUSED' ||
      code === 'ECONNRESET' ||
      code === 'ETIMEDOUT' ||
      code === 'ENOTFOUND' ||
      code === 'EAI_AGAIN' ||
      code === 'P1001' ||
      code === 'P1002' ||
      code === 'P1008' ||
      code === 'P1017' ||
      code === 'P2024'
    ) {
      return new TransientError(message, code);
    }
    if (code === 'P2002' || code === 'P2025') {
      return new PermanentError(message, code);
    }
  }

  return new TransientError(err instanceof Error ? err.message : String(err), fallbackCode);
}
