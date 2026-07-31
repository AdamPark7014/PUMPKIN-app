import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Observable } from 'rxjs';
import type { AuthenticatedUser } from '../modules/auth/auth.types';

interface Bucket {
  count: number;
  resetAt: number;
}

@Injectable()
export class AntiAbuseInterceptor implements NestInterceptor {
  private readonly buckets = new Map<string, Bucket>();
  private readonly maximumBuckets = 50_000;

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<
      Request & { user?: AuthenticatedUser }
    >();
    const policy = this.policy(request);
    if (policy) {
      const ip = request.ip ?? request.socket.remoteAddress ?? 'unknown';
      this.consume(`${policy.name}:ip:${ip}`, policy.limit, policy.ttl);
      if (request.user?.sub) {
        this.consume(`${policy.name}:user:${request.user.sub}`, policy.limit, policy.ttl);
      }
    }
    return next.handle();
  }

  private policy(request: Request): { name: string; limit: number; ttl: number } | undefined {
    const path = request.path.toLowerCase();
    if (path.includes('/auth/login')) return { name: 'login', limit: 5, ttl: 60_000 };
    if (path.includes('/auth/forgot-password')) {
      return { name: 'password-recovery', limit: 3, ttl: 15 * 60_000 };
    }
    if (path.includes('/payment') || path.includes('/refund')) {
      return { name: 'payment', limit: 20, ttl: 60_000 };
    }
    return undefined;
  }

  private consume(key: string, limit: number, ttl: number): void {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.prune();
      this.buckets.set(key, { count: 1, resetAt: now + ttl });
      return;
    }
    bucket.count += 1;
    if (bucket.count > limit) {
      throw new HttpException(
        {
          statusCode: 429,
          message: 'Rate limit exceeded',
          retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private prune(): void {
    if (this.buckets.size < this.maximumBuckets) return;
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
    if (this.buckets.size >= this.maximumBuckets) {
      const first = this.buckets.keys().next();
      if (!first.done) this.buckets.delete(first.value);
    }
  }
}
