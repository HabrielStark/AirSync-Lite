import { EventEmitter } from 'events';
import * as os from 'os';
import * as path from 'path';
import { WatcherOptions, WatchEvent } from './EventTypes';
import { logger } from '../../utils/logger';

export interface PlatformAdapter extends EventEmitter {
  start(): Promise<void>;
  stop(): Promise<void>;
  watch(folderId: string, absolutePath: string): Promise<void>;
  unwatch(folderId: string): Promise<void>;
}

export function createPlatformAdapter(options: WatcherOptions): PlatformAdapter {
  const platform = os.platform();

  if (platform === 'darwin') {
    logger.warn('macOS native watcher not available; using chokidar fallback.');
    return new GenericAdapter(options, 'darwin');
  }

  if (platform === 'win32') {
    logger.warn('Windows native watcher not available; using chokidar fallback.');
    return new GenericAdapter(options, 'win32');
  }

  return new GenericAdapter(options, platform);
}

abstract class BaseAdapter extends EventEmitter implements PlatformAdapter {
  protected readonly watchers: Map<string, any> = new Map();

  constructor(protected readonly options: WatcherOptions) {
    super();
  }

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract watch(folderId: string, absolutePath: string): Promise<void>;
  abstract unwatch(folderId: string): Promise<void>;

  protected emitEvent(event: WatchEvent): void {
    this.emit('event', event);
  }
}

class GenericAdapter extends BaseAdapter {
  private chokidar?: typeof import('chokidar');
  private readonly platformLabel: string;

  constructor(options: WatcherOptions, platform: NodeJS.Platform) {
    super(options);
    this.platformLabel = platform;
  }

  async start(): Promise<void> {
    this.chokidar = await import('chokidar');
    logger.info(`Generic watcher initialized using chokidar (${this.platformLabel}).`);
  }

  async stop(): Promise<void> {
    await Promise.all([...this.watchers.values()].map((watcher) => watcher.close()));
    this.watchers.clear();
  }

  async watch(folderId: string, absolutePath: string): Promise<void> {
    if (!this.chokidar) {
      throw new Error('Adapter not started');
    }

    const watcher = this.chokidar.watch(absolutePath, {
      persistent: this.options.persistent,
      followSymlinks: this.options.followSymlinks,
      depth: this.options.depth,
      ignored: this.options.ignoredPatterns,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: this.options.debounceMs,
        pollInterval: 100,
      },
    });

    watcher
      .on('add', (filePath: string, stats: any) => {
        this.emitEvent(this.mapEvent('add', folderId, absolutePath, filePath, stats));
      })
      .on('change', (filePath: string, stats: any) => {
        this.emitEvent(this.mapEvent('change', folderId, absolutePath, filePath, stats));
      })
      .on('unlink', (filePath: string) => {
        this.emitEvent(this.mapEvent('unlink', folderId, absolutePath, filePath));
      })
      .on('addDir', (dirPath: string) => {
        this.emitEvent(this.mapEvent('addDir', folderId, absolutePath, dirPath));
      })
      .on('unlinkDir', (dirPath: string) => {
        this.emitEvent(this.mapEvent('unlinkDir', folderId, absolutePath, dirPath));
      })
      .on('error', (error: Error) => {
        this.emit('error', error);
      });

    this.watchers.set(folderId, watcher);
  }

  async unwatch(folderId: string): Promise<void> {
    const watcher = this.watchers.get(folderId);
    if (watcher) {
      await watcher.close();
      this.watchers.delete(folderId);
    }
  }

  private mapEvent(
    type: WatchEvent['type'],
    folderId: string,
    root: string,
    targetPath: string,
    stats?: any
  ): WatchEvent {
    const relativePath = path.relative(root, targetPath);
    const absolutePath = path.resolve(targetPath);
    const base = {
      id: `${folderId}:${type}:${relativePath}:${Date.now()}`,
      type,
      absolutePath,
      relativePath,
      folderId,
      timestamp: Date.now(),
    } as WatchEvent;

    if (type === 'add' || type === 'change' || type === 'unlink' || type === 'rename') {
      return {
        ...base,
        type,
        size: stats?.size ?? 0,
        metadata: stats
          ? {
              permissions: stats.mode ?? 0,
              createdAt: stats.birthtimeMs ?? Date.now(),
              modifiedAt: stats.mtimeMs ?? Date.now(),
              accessedAt: stats.atimeMs ?? Date.now(),
            }
          : undefined,
      };
    }

    return {
      ...base,
      type: type as 'addDir' | 'unlinkDir',
    };
  }
}
