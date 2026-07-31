import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

interface AttemptState {
  failures: number;
  blockedUntil: number;
  lastFailure: number;
}

@Injectable()
export class LoginProtectionService {
  private readonly attempts = new Map<string, AttemptState>();
  private readonly maximumEntries = 20_000;

  assertAllowed(email: string, ipAddress: string): void {
    const state = this.attempts.get(this.key(email, ipAddress));
    if (!state) return;
    const now = Date.now();
    if (now - state.lastFailure > 24 * 60 * 60 * 1000) {
      this.attempts.delete(this.key(email, ipAddress));
      return;
    }
    if (state.blockedUntil > now) {
      throw new HttpException(
        {
          statusCode: 429,
          message: 'Too many failed attempts. Try again later.',
          retryAfterSeconds: Math.ceil((state.blockedUntil - now) / 1000),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  recordFailure(email: string, ipAddress: string): void {
    this.prune();
    const key = this.key(email, ipAddress);
    const previous = this.attempts.get(key);
    const failures = (previous?.failures ?? 0) + 1;
    const penaltySeconds =
      failures < 5 ? 0 : Math.min(15 * 60, 30 * 2 ** Math.min(failures - 5, 5));
    this.attempts.set(key, {
      failures,
      blockedUntil: Date.now() + penaltySeconds * 1000,
      lastFailure: Date.now(),
    });
  }

  recordSuccess(email: string, ipAddress: string): void {
    this.attempts.delete(this.key(email, ipAddress));
  }

  private key(email: string, ipAddress: string): string {
    return `${email.trim().toLowerCase()}:${ipAddress}`;
  }

  private prune(): void {
    if (this.attempts.size < this.maximumEntries) return;
    const oldest = [...this.attempts.entries()].sort(
      (left, right) => left[1].lastFailure - right[1].lastFailure,
    );
    for (const [key] of oldest.slice(0, Math.ceil(this.maximumEntries / 10))) {
      this.attempts.delete(key);
    }
  }
}
