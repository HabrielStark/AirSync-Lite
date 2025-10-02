import * as path from 'path';
import { SnapshotEntry, SnapshotMap } from './EventTypes';

export interface SnapshotStoreOptions {
  maxEntries: number;
  enablePersistence: boolean;
  persistencePath?: string;
}

export class SnapshotStore {
  private readonly snapshots: SnapshotMap = new Map();

  constructor(private readonly options: SnapshotStoreOptions) {}

  load(initial: SnapshotEntry[]): void {
    this.snapshots.clear();
    initial.forEach((entry) => {
      this.snapshots.set(this.normalize(entry.relativePath), entry);
    });
  }

  add(entry: SnapshotEntry): void {
    if (this.snapshots.size >= this.options.maxEntries) {
      this.evict();
    }

    this.snapshots.set(this.normalize(entry.relativePath), entry);
  }

  remove(relativePath: string): void {
    this.snapshots.delete(this.normalize(relativePath));
  }

  get(relativePath: string): SnapshotEntry | undefined {
    return this.snapshots.get(this.normalize(relativePath));
  }

  list(): SnapshotEntry[] {
    return [...this.snapshots.values()];
  }

  compare(entry: SnapshotEntry): 'new' | 'modified' | 'unchanged' {
    const existing = this.get(entry.relativePath);
    if (!existing) {
      return 'new';
    }

    if (
      existing.hash !== entry.hash ||
      existing.size !== entry.size ||
      existing.modifiedAt !== entry.modifiedAt
    ) {
      return 'modified';
    }

    return 'unchanged';
  }

  private evict(): void {
    const oldest = [...this.snapshots.values()].sort((a, b) => a.modifiedAt - b.modifiedAt)[0];
    if (oldest) {
      this.snapshots.delete(this.normalize(oldest.relativePath));
    }
  }

  private normalize(relativePath: string): string {
    return path.normalize(relativePath);
  }
}
