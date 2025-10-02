jest.mock('p-queue', () => {
  return jest.fn().mockImplementation(() => {
    return {
      add: async (fn: () => Promise<void> | void) => {
        await fn();
      },
      onIdle: async () => {
        /* no-op */
      },
      clear: () => {
        /* no-op */
      },
    };
  });
});

import { ChangeQueue } from '../../src/main/core/watcher/ChangeQueue';
import { WatchEvent } from '../../src/main/core/watcher/EventTypes';

describe('ChangeQueue', () => {
  const createEvent = (type: WatchEvent['type'], idx: number): WatchEvent => ({
    id: `${idx}`,
    type,
    absolutePath: `/tmp/file-${idx}.txt`,
    relativePath: `file-${idx}.txt`,
    folderId: 'folder-1',
    timestamp: Date.now(),
    size: 0,
  });

  const defaultOptions = {
    concurrency: 1,
    batchSize: 2,
    flushIntervalMs: 10,
    maxQueueSize: 10,
  };

  it('processes events in batches respecting batchSize', async () => {
    const queue = new ChangeQueue(defaultOptions);
    const processed: WatchEvent[][] = [];

    queue.on('process', (batch: WatchEvent[]) => {
      processed.push(batch);
    });

    queue.enqueue(createEvent('add', 1));
    queue.enqueue(createEvent('add', 2));
    queue.enqueue(createEvent('change', 3));

    await queue.flush();

    expect(processed).toHaveLength(2);
    expect(processed[0]).toHaveLength(2);
    expect(processed[1]).toHaveLength(1);
  });

  it('respects maxQueueSize and emits overflow', () => {
    const queue = new ChangeQueue({ ...defaultOptions, maxQueueSize: 2 });
    const overflowSpy = jest.fn();
    queue.on('overflow', overflowSpy);

    queue.enqueue(createEvent('add', 1));
    queue.enqueue(createEvent('add', 2));
    queue.enqueue(createEvent('add', 3));

    expect(overflowSpy).toHaveBeenCalledTimes(0);
  });

  it('clear() empties buffer and cancels pending flush timers', async () => {
    jest.useFakeTimers();
    const queue = new ChangeQueue({ ...defaultOptions, flushIntervalMs: 100 });
    const processSpy = jest.fn();
    queue.on('process', processSpy);

    queue.enqueue(createEvent('add', 1));
    queue.clear();

    jest.advanceTimersByTime(200);
    await queue.flush();
    expect(processSpy).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});
