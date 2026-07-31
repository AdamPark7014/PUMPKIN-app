import { TransientError } from './errors';

/**
 * Limits concurrent job executions (backpressure) beyond Bull's processor concurrency.
 */
export class ConcurrencyGate {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly maxInFlight: number) {
    if (maxInFlight < 1) {
      throw new Error('maxInFlight must be >= 1');
    }
  }

  getActive(): number {
    return this.active;
  }

  async acquire(): Promise<void> {
    if (this.active < this.maxInFlight) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      this.waiters.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  tryAcquire(): boolean {
    if (this.active < this.maxInFlight) {
      this.active += 1;
      return true;
    }
    return false;
  }

  release(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.waiters.shift();
    if (next) next();
  }

  assertCapacity(): void {
    if (this.active >= this.maxInFlight) {
      throw new TransientError('backpressure: max in-flight jobs reached', 'BACKPRESSURE');
    }
  }
}
