import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './modules/prisma/prisma.service';
import { RedisService } from './common/redis.service';

@Injectable()
export class AppService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  async getHealth() {
    let database: 'up' | 'down' = 'down';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = 'up';
    } catch {
      database = 'down';
    }

    const redis: 'up' | 'down' | 'optional' = this.redis.isReady ? 'up' : 'down';

    return {
      status: database === 'up' ? 'ok' : 'degraded',
      service: 'boletera-api',
      version: '1.0.0',
      database,
      redis,
      payments: 'BANORTE',
      timestamp: new Date().toISOString(),
    };
  }

  /** Readiness: DB required; Redis preferred but not fatal for holds-fallback mode. */
  async getReady() {
    const health = await this.getHealth();
    if (health.database !== 'up') {
      throw new ServiceUnavailableException({
        ready: false,
        ...health,
        reason: 'database_unavailable',
      });
    }
    return {
      ready: true,
      ...health,
      redisRequired: false,
      note:
        health.redis === 'down'
          ? 'Redis down — seat holds fall back to DB only'
          : 'All critical dependencies up',
    };
  }
}
