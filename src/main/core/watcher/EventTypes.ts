export type WatchEventType = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir' | 'rename';

export interface WatchEventBase {
  id: string;
  type: WatchEventType;
  absolutePath: string;
  relativePath: string;
  folderId: string;
  timestamp: number;
  inode?: number;
}

export interface FileWatchEvent extends WatchEventBase {
  type: 'add' | 'change' | 'unlink' | 'rename';
  size: number;
  hash?: string;
  previousHash?: string;
  metadata?: FileMetadata;
}

export interface DirectoryWatchEvent extends WatchEventBase {
  type: 'addDir' | 'unlinkDir';
  childrenCount?: number;
}

export type WatchEvent = FileWatchEvent | DirectoryWatchEvent;

export interface FileMetadata {
  permissions: number;
  owner?: string;
  group?: string;
  createdAt: number;
  modifiedAt: number;
  accessedAt: number;
}

export interface WatcherOptions {
  useNativeEvents: boolean;
  debounceMs: number;
  hashingEnabled: boolean;
  hashingBlockSize: number;
  followSymlinks: boolean;
  persistent: boolean;
  depth?: number;
  ignoredPatterns?: string[];
}

export interface SnapshotEntry {
  relativePath: string;
  size: number;
  hash: string;
  modifiedAt: number;
  inode?: number;
}

export type SnapshotMap = Map<string, SnapshotEntry>;
