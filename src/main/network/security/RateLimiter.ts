import { EventEmitter } from 'events';

interface RateLimiterOptions {
  points: number; // Number of requests allowed
  duration: number; // Time window in seconds
  blockDuration: number; // Block duration in seconds after limit exceeded
}

interface RateLimitResult {
  success: boolean;
  remainingPoints?: number;
  msBeforeNext?: number;
}

export class RateLimiter extends EventEmitter {
  private readonly tokens: Map<
    string,
    { count: number; lastReset: number; blockedUntil?: number }
  > = new Map();
  private readonly points: number;
  private readonly durationMs: number;
  private readonly blockDurationMs: number;

  constructor(options: RateLimiterOptions);
  constructor(limit: number, intervalMs: number);
  constructor(optionsOrLimit: RateLimiterOptions | number, intervalMs?: number) {
    super();

    if (typeof optionsOrLimit === 'object') {
      this.points = optionsOrLimit.points;
      this.durationMs = optionsOrLimit.duration * 1000;
      this.blockDurationMs = optionsOrLimit.blockDuration * 1000;
    } else {
      this.points = optionsOrLimit;
      this.durationMs = intervalMs!;
      this.blockDurationMs = this.durationMs * 5; // Default: 5x the interval
    }
  }

  async consume(key: string, points: number = 1): Promise<RateLimitResult> {
    const now = Date.now();
    const entry = this.tokens.get(key) ?? { count: 0, lastReset: now };

    // Check if blocked
    if (entry.blockedUntil && now < entry.blockedUntil) {
      return {
        success: false,
        msBeforeNext: entry.blockedUntil - now,
      };
    }

    // Reset if window expired
    if (now - entry.lastReset > this.durationMs) {
      entry.count = 0;
      entry.lastReset = now;
      delete entry.blockedUntil;
    }

    // Check limit
    if (entry.count + points > this.points) {
      entry.blockedUntil = now + this.blockDurationMs;
      this.tokens.set(key, entry);
      this.emit('rate-limit', key);
      return {
        success: false,
        msBeforeNext: this.blockDurationMs,
      };
    }

    // Consume points
    entry.count += points;
    this.tokens.set(key, entry);

    return {
      success: true,
      remainingPoints: this.points - entry.count,
    };
  }

  check(peerId: string): boolean {
    const now = Date.now();
    const entry = this.tokens.get(peerId) ?? { count: 0, lastReset: now };

    // Check if blocked
    if (entry.blockedUntil && now < entry.blockedUntil) {
      return false;
    }

    if (now - entry.lastReset > this.durationMs) {
      entry.count = 0;
      entry.lastReset = now;
      delete entry.blockedUntil;
    }

    entry.count += 1;
    this.tokens.set(peerId, entry);

    if (entry.count > this.points) {
      entry.blockedUntil = now + this.blockDurationMs;
      this.emit('rate-limit', peerId);
      return false;
    }

    return true;
  }

  reset(key: string): void {
    this.tokens.delete(key);
  }

  resetAll(): void {
    this.tokens.clear();
  }
}
