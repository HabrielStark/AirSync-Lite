import { EventEmitter } from 'events';
import PQueue from 'p-queue';
import { WatchEvent } from './EventTypes';

export interface ChangeQueueOptions {
  concurrency: number;
  batchSize: number;
  flushIntervalMs: number;
  maxQueueSize: number;
}

export interface ChangeBatch {
  events: WatchEvent[];
  startedAt: number;
  completedAt?: number;
}

export class ChangeQueue extends EventEmitter {
  private readonly queue: PQueue;
  private buffer: WatchEvent[] = [];
  private flushTimer?: NodeJS.Timeout;

  constructor(private readonly options: ChangeQueueOptions) {
    super();
    this.queue = new PQueue({ concurrency: options.concurrency });
  }

  enqueue(event: WatchEvent): void {
    // ✅ CRITICAL FIX: Handle overflow by forcing flush, not dropping events
    if (this.buffer.length >= this.options.maxQueueSize) {
      this.emit('overflow', event);
      // Force immediate flush to make room
      void this.flush().then(() => {
        // Add event after flush
        this.buffer.push(event);
      });
      return;
    }

    this.buffer.push(event);

    if (this.buffer.length >= this.options.batchSize) {
      void this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        void this.flush();
      }, this.options.flushIntervalMs);
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) {
      return;
    }

    const snapshot = this.buffer;
    this.buffer = [];

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }

    const batch: ChangeBatch = {
      events: snapshot,
      startedAt: Date.now(),
    };

    await this.queue.add(async () => {
      try {
        this.emit('batch-start', batch);
        this.emit('process', batch.events);
        batch.completedAt = Date.now();
        this.emit('batch-complete', batch);
      } catch (error) {
        this.emit('batch-error', error, batch);
      }
    });
  }

  async drain(): Promise<void> {
    await this.flush();
    await this.queue.onIdle();
  }

  clear(): void {
    this.buffer = [];
    this.queue.clear();

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
  }
}
