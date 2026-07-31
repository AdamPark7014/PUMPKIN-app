import type { NextFunction, Request, Response } from 'express';

export function parseCookies(request: Request, _response: Response, next: NextFunction): void {
  const parsed: Record<string, string> = {};
  const raw = request.headers.cookie;
  if (raw) {
    for (const pair of raw.split(';')) {
      const separator = pair.indexOf('=');
      if (separator < 1) continue;
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      try {
        parsed[name] = decodeURIComponent(value);
      } catch {
        parsed[name] = value;
      }
    }
  }
  request.cookies = parsed;
  next();
}
