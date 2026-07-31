export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogFields {
  correlationId?: string;
  job?: string;
  jobId?: string | number;
  attempt?: number;
  durationMs?: number;
  code?: string;
  released?: number;
  pending?: number;
  completed?: number;
  checked?: number;
  status?: number;
  queue?: string;
  reason?: string;
  errorName?: string;
  permanent?: boolean;
  queueDepth?: number;
  dlqDepth?: number;
}

const PII_KEYS = new Set([
  'email',
  'buyername',
  'firstname',
  'lastname',
  'name',
  'phone',
  'sessionid',
  'userid',
  'cashierid',
  'password',
  'token',
  'secret',
  'authorization',
  'card',
  'clabe',
  'account',
]);

const MAX_STRING_LENGTH = 500;

function redact(value: string): string {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
    .replace(/\b(?:bearer\s+)?[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]{10,})?\b/gi, '[REDACTED_TOKEN]')
    .replace(/([?&](?:token|secret|key|email|phone|account|clabe)=)[^&\s]*/gi, '$1[REDACTED]')
    .replace(/\b\d{18}\b/g, '[REDACTED_ACCOUNT]')
    .slice(0, MAX_STRING_LENGTH);
}

export function sanitizeFields(fields: LogFields): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
    if (value === undefined) continue;
    if (PII_KEYS.has(key.toLowerCase())) continue;
    if (typeof value === 'string') {
      out[key] = redact(value);
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = value;
    } else if (typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return out;
}

function emit(level: LogLevel, message: string, fields: LogFields = {}): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg: message,
    service: 'worker',
    ...sanitizeFields(fields),
  });
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (message: string, fields?: LogFields) => emit('debug', message, fields),
  info: (message: string, fields?: LogFields) => emit('info', message, fields),
  warn: (message: string, fields?: LogFields) => emit('warn', message, fields),
  error: (message: string, fields?: LogFields) => emit('error', message, fields),
};
