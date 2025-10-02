import { EventEmitter } from 'events';
import { SnapshotEntry, WatchEvent, WatcherOptions } from './EventTypes';
import { SnapshotStore } from './SnapshotStore';
import { Hashing } from './Hashing';

interface TrackerOptions {
  watcherOptions: WatcherOptions;
  snapshotStore: SnapshotStore;
  hashing: Hashing;
}

export class Tracker extends EventEmitter {
  constructor(private readonly options: TrackerOptions) {
    super();
  }

  async handleEvent(event: WatchEvent): Promise<void> {
    if (event.type === 'add' || event.type === 'change' || event.type === 'rename') {
      await this.handleFileChange(event);
    } else if (event.type === 'unlink') {
      this.handleFileDelete(event);
    } else if (event.type === 'addDir') {
      this.handleDirectoryAdd(event);
    } else if (event.type === 'unlinkDir') {
      this.handleDirectoryRemove(event);
    }
  }

  getSnapshot(relativePath: string): SnapshotEntry | undefined {
    return this.options.snapshotStore.get(relativePath);
  }

  listSnapshots(): SnapshotEntry[] {
    return this.options.snapshotStore.list();
  }

  private async handleFileChange(event: WatchEvent): Promise<void> {
    if (event.type === 'unlink') {
      return;
    }

    const hash = await this.options.hashing.hashFile(event.absolutePath);
    const snapshot: SnapshotEntry = {
      relativePath: event.relativePath,
      size: hash.size,
      hash: hash.hash,
      modifiedAt: event.timestamp,
    };

    const status = this.options.snapshotStore.compare(snapshot);
    this.options.snapshotStore.add(snapshot);

    this.emit('file-change', { event, status, snapshot });
  }

  private handleFileDelete(event: WatchEvent): void {
    this.options.snapshotStore.remove(event.relativePath);
    this.emit('file-delete', { event });
  }

  private handleDirectoryAdd(event: WatchEvent): void {
    this.emit('dir-add', { event });
  }

  private handleDirectoryRemove(event: WatchEvent): void {
    this.emit('dir-remove', { event });
  }
}
