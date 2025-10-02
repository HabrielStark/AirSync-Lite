import * as chokidar from 'chokidar';
import * as path from 'path';
import * as fs from 'fs/promises';
import { Stats } from 'fs';
import * as crypto from 'crypto';
import Store from 'electron-store';
import { EventEmitter } from 'events';
import { FileInfo, FolderConfig } from '../../shared/types/sync';
import { AppConfig } from '../../shared/types/config';
import { IgnoreParser } from '../utils/ignoreParser';
import { logger } from '../utils/logger';

export interface FileChangeEvent {
  type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';
  path: string;
  relativePath: string;
  folderId: string;
  stats?: Stats;
  hash?: string;
}

export class FileWatcher extends EventEmitter {
  private watchers: Map<string, chokidar.FSWatcher> = new Map();
  private ignoreParsers: Map<string, IgnoreParser> = new Map();
  private fileHashes: Map<string, string> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private readonly DEBOUNCE_MS = 300;
  private readonly HASH_CHUNK_SIZE = 65536; // 64KB chunks for hashing

  constructor(private store: Store<AppConfig>) {
    super();
  }

  async watchFolder(folder: FolderConfig): Promise<void> {
    if (this.watchers.has(folder.id)) {
      logger.warn(`Folder ${folder.id} is already being watched`);
      return;
    }

    try {
      // Initialize ignore parser for this folder
      const ignoreParser = new IgnoreParser();
      await ignoreParser.loadFromFolder(folder.path);

      // Apply preset patterns
      if (folder.ignorePatterns.length > 0) {
        ignoreParser.addPatterns(folder.ignorePatterns);
      }

      this.ignoreParsers.set(folder.id, ignoreParser);

      // Create watcher
      const watcher = chokidar.watch(folder.path, {
        persistent: true,
        ignoreInitial: false,
        followSymlinks: this.store.get('advanced.symbolicLinks') === 'follow',
        awaitWriteFinish: {
          stabilityThreshold: 2000,
          pollInterval: 100,
        },
        ignored: (filePath: string) => {
          const relativePath = path.relative(folder.path, filePath);
          return ignoreParser.isIgnored(relativePath);
        },
        depth: undefined,
        usePolling: false,
        interval: 100,
        binaryInterval: 300,
        alwaysStat: true,
        atomic: true,
      });

      // Set up event handlers
      watcher
        .on('add', (filePath: string, stats?: Stats) =>
          this.handleFileEvent('add', filePath, folder, stats)
        )
        .on('change', (filePath: string, stats?: Stats) =>
          this.handleFileEvent('change', filePath, folder, stats)
        )
        .on('unlink', (filePath: string) => this.handleFileEvent('unlink', filePath, folder))
        .on('addDir', (dirPath: string, stats?: Stats) =>
          this.handleFileEvent('addDir', dirPath, folder, stats)
        )
        .on('unlinkDir', (dirPath: string) => this.handleFileEvent('unlinkDir', dirPath, folder))
        .on('error', (error: Error) => this.handleWatcherError(error, folder))
        .on('ready', () => logger.info(`Watcher ready for folder: ${folder.path}`));

      this.watchers.set(folder.id, watcher);
      logger.info(`Started watching folder: ${folder.path}`);
    } catch (error) {
      logger.error(`Failed to watch folder ${folder.path}:`, error);
      throw error;
    }
  }

  async unwatchFolder(folderId: string): Promise<void> {
    const watcher = this.watchers.get(folderId);
    if (watcher) {
      await watcher.close();
      this.watchers.delete(folderId);
      this.ignoreParsers.delete(folderId);
      logger.info(`Stopped watching folder: ${folderId}`);
    }
  }

  async stop(): Promise<void> {
    const closePromises = Array.from(this.watchers.values()).map((watcher) => watcher.close());
    await Promise.all(closePromises);
    this.watchers.clear();
    this.ignoreParsers.clear();
    this.fileHashes.clear();

    // Clear all debounce timers
    this.debounceTimers.forEach((timer) => clearTimeout(timer));
    this.debounceTimers.clear();

    logger.info('File watcher stopped');
  }

  private handleFileEvent(
    type: FileChangeEvent['type'],
    filePath: string,
    folder: FolderConfig,
    stats?: Stats
  ): void {
    const relativePath = path.relative(folder.path, filePath);

    // Debounce rapid file changes
    const debounceKey = `${folder.id}:${filePath}`;
    const existingTimer = this.debounceTimers.get(debounceKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(async () => {
      this.debounceTimers.delete(debounceKey);

      try {
        // Calculate hash for file changes
        let hash: string | undefined;
        if ((type === 'add' || type === 'change') && stats?.isFile()) {
          hash = await this.calculateFileHash(filePath);

          // Check if file actually changed
          if (type === 'change') {
            const previousHash = this.fileHashes.get(filePath);
            if (previousHash === hash) {
              logger.debug(`File ${relativePath} hash unchanged, skipping`);
              return;
            }
          }

          this.fileHashes.set(filePath, hash);
        } else if (type === 'unlink') {
          this.fileHashes.delete(filePath);
        }

        const event: FileChangeEvent = {
          type,
          path: filePath,
          relativePath,
          folderId: folder.id,
          stats,
          hash,
        };

        this.emit('file-change', event);
        logger.debug(`File event: ${type} - ${relativePath}`);
      } catch (error) {
        logger.error(`Error handling file event for ${filePath}:`, error);
      }
    }, this.DEBOUNCE_MS);

    this.debounceTimers.set(debounceKey, timer);
  }

  private handleWatcherError(error: Error, folder: FolderConfig): void {
    logger.error(`Watcher error for folder ${folder.path}:`, error);
    this.emit('watcher-error', { folderId: folder.id, error });
  }

  private async calculateFileHash(filePath: string): Promise<string> {
    const hash = crypto.createHash('sha256');
    const stream = await fs.open(filePath, 'r');
    const buffer = Buffer.alloc(this.HASH_CHUNK_SIZE);

    try {
      let position = 0;
      let bytesRead: number;

      do {
        const result = await stream.read(buffer, 0, this.HASH_CHUNK_SIZE, position);
        bytesRead = result.bytesRead;

        if (bytesRead > 0) {
          hash.update(buffer.slice(0, bytesRead));
          position += bytesRead;
        }
      } while (bytesRead > 0);

      return hash.digest('hex');
    } finally {
      await stream.close();
    }
  }

  async scanFolder(folder: FolderConfig): Promise<FileInfo[]> {
    const files: FileInfo[] = [];
    const ignoreParser = this.ignoreParsers.get(folder.id);

    if (!ignoreParser) {
      throw new Error(`No ignore parser found for folder ${folder.id}`);
    }

    const scanDirectory = async (dirPath: string): Promise<void> => {
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          const relativePath = path.relative(folder.path, fullPath);

          // Skip ignored files
          if (ignoreParser.isIgnored(relativePath)) {
            continue;
          }

          try {
            const stats = await fs.stat(fullPath);

            const fileInfo: FileInfo = {
              path: fullPath,
              relativePath,
              name: entry.name,
              size: stats.size,
              type: entry.isDirectory() ? 'directory' : entry.isSymbolicLink() ? 'symlink' : 'file',
              modifiedAt: stats.mtime,
              createdAt: stats.ctime,
              permissions: stats.mode,
              isIgnored: false,
            };

            // Calculate hash for files
            if (fileInfo.type === 'file') {
              fileInfo.hash = await this.calculateFileHash(fullPath);
              this.fileHashes.set(fullPath, fileInfo.hash);
            }

            files.push(fileInfo);

            // Recursively scan subdirectories
            if (entry.isDirectory()) {
              await scanDirectory(fullPath);
            }
          } catch (error) {
            logger.warn(`Failed to stat file ${fullPath}:`, error);
          }
        }
      } catch (error) {
        logger.error(`Failed to scan directory ${dirPath}:`, error);
      }
    };

    await scanDirectory(folder.path);
    return files;
  }

  isWatching(folderId: string): boolean {
    return this.watchers.has(folderId);
  }

  getWatchedFolders(): string[] {
    return Array.from(this.watchers.keys());
  }

  async updateIgnorePatterns(folderId: string, patterns: string[]): Promise<void> {
    const ignoreParser = this.ignoreParsers.get(folderId);
    if (ignoreParser) {
      ignoreParser.clearPatterns();
      ignoreParser.addPatterns(patterns);

      // Restart watcher to apply new patterns
      const folder = this.store.get('folders').find((f) => f.id === folderId);
      if (folder) {
        await this.unwatchFolder(folderId);
        await this.watchFolder(folder);
      }
    }
  }
}
