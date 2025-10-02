import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import debounce from 'lodash.debounce';
import { ChangeQueue, ChangeQueueOptions } from './ChangeQueue';
import { createPlatformAdapter, PlatformAdapter } from './PlatformAdapter';
import { Tracker } from './Tracker';
import { WatchEvent, WatcherOptions } from './EventTypes';
import { SnapshotStore } from './SnapshotStore';
import { Hashing } from './Hashing';

export interface FileSystemWatcherOptions {
  watcher: WatcherOptions;
  queue: ChangeQueueOptions;
}

export class FileSystemWatcher extends EventEmitter {
  private readonly adapter: PlatformAdapter;
  private readonly queue: ChangeQueue;
  private readonly tracker: Tracker;
  private readonly folders: Map<string, string> = new Map();

  constructor(private readonly options: FileSystemWatcherOptions) {
    super();

    this.adapter = createPlatformAdapter(options.watcher);
    this.queue = new ChangeQueue(options.queue);
    const hashing = new Hashing({
      algorithm: 'sha256',
      blockSize: options.watcher.hashingBlockSize,
      rollingWindow: options.watcher.hashingBlockSize / 2,
    });
    this.tracker = new Tracker({
      watcherOptions: options.watcher,
      snapshotStore: new SnapshotStore({ maxEntries: 1_000_000, enablePersistence: false }),
      hashing,
    });

    this.adapter.on('event', (event: WatchEvent) => this.handleEvent(event));
    this.adapter.on('error', (error) => this.emit('error', error));
    this.queue.on('process', (events: WatchEvent[]) => {
      events.forEach((event) => {
        this.emit('event', event);
      });
    });

    const debouncedFlush = debounce(() => {
      void this.queue.flush();
    }, options.queue.flushIntervalMs);

    this.tracker.on('file-change', (meta) => {
      this.queue.enqueue({ ...meta.event, hash: meta.snapshot.hash });
      debouncedFlush();
    });
    this.tracker.on('file-delete', (meta) => {
      this.queue.enqueue(meta.event);
      debouncedFlush();
    });
    this.tracker.on('dir-add', (meta) => {
      this.queue.enqueue(meta.event);
      debouncedFlush();
    });
    this.tracker.on('dir-remove', (meta) => {
      this.queue.enqueue(meta.event);
      debouncedFlush();
    });
  }

  async start(): Promise<void> {
    await this.adapter.start();
  }

  async stop(): Promise<void> {
    await this.queue.drain();
    await this.adapter.stop();
  }

  async addFolder(absolutePath: string): Promise<string> {
    const folderId = uuidv4();
    this.folders.set(folderId, absolutePath);
    await this.adapter.watch(folderId, absolutePath);
    return folderId;
  }

  async removeFolder(folderId: string): Promise<void> {
    await this.adapter.unwatch(folderId);
    this.folders.delete(folderId);
  }

  private async handleEvent(event: WatchEvent): Promise<void> {
    if (!this.folders.has(event.folderId)) {
      return;
    }

    await this.tracker.handleEvent(event);
  }
}
