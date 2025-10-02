import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import Store from 'electron-store';
import { AppConfig } from '../../shared/types/config';
import { FolderConfig } from '../../shared/types/sync';
import { logger } from '../utils/logger';

interface DeletionRecord {
  id: string;
  path: string;
  deletedAt: number;
  deviceId: string;
  tombstoneExpiry: number;
}

interface DeletionSyncOptions {
  store: Store<AppConfig>;
  tombstoneRetentionDays: number;
}

export class DeletionSyncManager extends EventEmitter {
  private tombstones: Map<string, DeletionRecord> = new Map();
  private readonly DEFAULT_RETENTION_DAYS = 30;

  constructor(private options: DeletionSyncOptions) {
    super();
    this.loadTombstones();
  }

  async initialize(): Promise<void> {
    await this.loadTombstones();
    this.startCleanupSchedule();
    logger.info('Deletion sync manager initialized');
  }

  async recordDeletion(filePath: string, folderId: string, deviceId: string): Promise<void> {
    const now = Date.now();
    const retentionMs =
      (this.options.tombstoneRetentionDays || this.DEFAULT_RETENTION_DAYS) * 24 * 60 * 60 * 1000;

    const record: DeletionRecord = {
      id: `${folderId}:${filePath}`,
      path: filePath,
      deletedAt: now,
      deviceId,
      tombstoneExpiry: now + retentionMs,
    };

    this.tombstones.set(record.id, record);
    await this.saveTombstones();

    logger.info(`Recorded deletion: ${filePath} by ${deviceId}`);
    this.emit('deletion-recorded', record);
  }

  async handleRemoteDeletion(
    filePath: string,
    folderId: string,
    deviceId: string,
    folder: FolderConfig
  ): Promise<void> {
    const tombstoneId = `${folderId}:${filePath}`;

    // Check if we already know about this deletion
    if (this.tombstones.has(tombstoneId)) {
      logger.debug(`Deletion already known: ${filePath}`);
      return;
    }

    // Record the tombstone
    await this.recordDeletion(filePath, folderId, deviceId);

    // Perform local deletion if file exists
    const fullPath = `${folder.path}/${filePath}`;

    try {
      await fs.access(fullPath);
      await fs.unlink(fullPath);
      logger.info(`Deleted local file: ${fullPath}`);
      this.emit('local-file-deleted', { path: fullPath, reason: 'remote-deletion' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.error(`Failed to delete local file: ${fullPath}`, error);
        throw error;
      }
      // File doesn't exist, nothing to do
      logger.debug(`File already deleted: ${fullPath}`);
    }
  }

  isDeletionKnown(filePath: string, folderId: string): boolean {
    const tombstoneId = `${folderId}:${filePath}`;
    const record = this.tombstones.get(tombstoneId);

    if (!record) {
      return false;
    }

    // Check if tombstone has expired
    if (Date.now() > record.tombstoneExpiry) {
      this.tombstones.delete(tombstoneId);
      return false;
    }

    return true;
  }

  async resolveDeletionConflict(
    filePath: string,
    folderId: string,
    localModifiedTime: number,
    deletionTime: number
  ): Promise<'keep' | 'delete'> {
    // If file was modified after deletion on another device, keep it (modification wins)
    if (localModifiedTime > deletionTime) {
      logger.info(`Keeping modified file over deletion: ${filePath}`);

      // Remove tombstone since file is being recreated
      const tombstoneId = `${folderId}:${filePath}`;
      this.tombstones.delete(tombstoneId);
      await this.saveTombstones();

      return 'keep';
    }

    // Otherwise, deletion wins
    logger.info(`Deleting file due to remote deletion: ${filePath}`);
    return 'delete';
  }

  async cleanup(): Promise<void> {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, record] of this.tombstones.entries()) {
      if (now > record.tombstoneExpiry) {
        this.tombstones.delete(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      await this.saveTombstones();
      logger.info(`Cleaned up ${cleaned} expired tombstones`);
    }
  }

  getTombstones(): DeletionRecord[] {
    return Array.from(this.tombstones.values());
  }

  private async loadTombstones(): Promise<void> {
    const tombstoneData = this.options.store.get('deletionTombstones' as any) || [];

    for (const record of tombstoneData as DeletionRecord[]) {
      // Only load non-expired tombstones
      if (Date.now() < record.tombstoneExpiry) {
        this.tombstones.set(record.id, record);
      }
    }

    logger.info(`Loaded ${this.tombstones.size} deletion tombstones`);
  }

  private async saveTombstones(): Promise<void> {
    const tombstoneData = Array.from(this.tombstones.values());
    this.options.store.set('deletionTombstones' as any, tombstoneData);
  }

  private startCleanupSchedule(): void {
    // Run cleanup every 6 hours
    setInterval(
      () => {
        this.cleanup();
      },
      6 * 60 * 60 * 1000
    );

    // Run cleanup on startup
    setTimeout(() => this.cleanup(), 1000);
  }
}
