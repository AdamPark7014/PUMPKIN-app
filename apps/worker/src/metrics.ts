export interface JobMetricSnapshot {
  readonly successes: number;
  readonly failures: number;
  readonly permanentFailures: number;
  readonly retries: number;
  readonly deadLetters: number;
  readonly totalDurationMs: number;
  readonly lastDurationMs: number;
  readonly lastStatus: 'success' | 'failure' | 'none';
  readonly lastAt: string | null;
}

export interface MetricsSnapshot {
  readonly startedAt: string;
  readonly jobs: Record<string, JobMetricSnapshot>;
  readonly inFlight: number;
  readonly ready: boolean;
  readonly shuttingDown: boolean;
}

class MetricsRegistry {
  private readonly startedAt = new Date().toISOString();
  private readonly jobs = new Map<string, {
    successes: number;
    failures: number;
    permanentFailures: number;
    retries: number;
    deadLetters: number;
    totalDurationMs: number;
    lastDurationMs: number;
    lastStatus: 'success' | 'failure' | 'none';
    lastAt: string | null;
  }>();
  private inFlight = 0;
  private ready = false;
  private shuttingDown = false;

  private bucket(job: string) {
    let b = this.jobs.get(job);
    if (!b) {
      b = {
        successes: 0,
        failures: 0,
        permanentFailures: 0,
        retries: 0,
        deadLetters: 0,
        totalDurationMs: 0,
        lastDurationMs: 0,
        lastStatus: 'none',
        lastAt: null,
      };
      this.jobs.set(job, b);
    }
    return b;
  }

  begin(): void {
    this.inFlight += 1;
  }

  end(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
  }

  recordSuccess(job: string, durationMs: number): void {
    const b = this.bucket(job);
    b.successes += 1;
    b.totalDurationMs += durationMs;
    b.lastDurationMs = durationMs;
    b.lastStatus = 'success';
    b.lastAt = new Date().toISOString();
  }

  recordAttempt(job: string, attempt: number): void {
    if (attempt > 1) this.bucket(job).retries += 1;
  }

  recordDeadLetter(job: string): void {
    this.bucket(job).deadLetters += 1;
  }

  recordFailure(job: string, durationMs: number, permanent: boolean): void {
    const b = this.bucket(job);
    b.failures += 1;
    if (permanent) b.permanentFailures += 1;
    b.totalDurationMs += durationMs;
    b.lastDurationMs = durationMs;
    b.lastStatus = 'failure';
    b.lastAt = new Date().toISOString();
  }

  setReady(ready: boolean): void {
    this.ready = ready;
  }

  setShuttingDown(shuttingDown: boolean): void {
    this.shuttingDown = shuttingDown;
  }

  getInFlight(): number {
    return this.inFlight;
  }

  isReady(): boolean {
    return this.ready && !this.shuttingDown;
  }

  isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  snapshot(): MetricsSnapshot {
    const jobs: Record<string, JobMetricSnapshot> = {};
    for (const [name, b] of this.jobs) {
      jobs[name] = { ...b };
    }
    return {
      startedAt: this.startedAt,
      jobs,
      inFlight: this.inFlight,
      ready: this.ready,
      shuttingDown: this.shuttingDown,
    };
  }
}

export const metrics = new MetricsRegistry();
