import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private client: RedisClientType;

  constructor() {
    this.client = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    });
    void this.client.connect().catch(() => {
      console.warn('Redis not available — holds will use DB only');
    });
  }

  get isReady(): boolean {
    return this.client.isReady;
  }

  async setHold(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    if (!this.client.isReady) return false;
    const result = await this.client.set(key, value, { NX: true, EX: ttlSeconds });
    return result === 'OK';
  }

  async del(key: string): Promise<void> {
    if (this.client.isReady) await this.client.del(key);
  }

  async get(key: string): Promise<string | null> {
    if (!this.client.isReady) return null;
    return this.client.get(key);
  }

  onModuleDestroy() {
    void this.client.quit();
  }
}


