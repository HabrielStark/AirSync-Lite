export interface FolderConfig {
  id: string;
  path: string;
  name: string;
  mode: 'send-receive' | 'receive-only';
  status: SyncStatus;
  devices: string[];
  ignorePatterns: string[];
  versioningPolicy: VersioningPolicy;
  createdAt: Date;
  updatedAt: Date;
  lastSyncAt?: Date;
  stats?: FolderStats;
}

export interface DeviceInfo {
  id: string;
  name: string;
  platform: 'darwin' | 'win32' | 'linux';
  role?: 'home' | 'school';
  status: 'online' | 'offline' | 'paused';
  address?: string;
  port?: number;
  lastSeenAt?: Date;
  pairedAt: Date;
  capabilities: DeviceCapabilities;
  publicKey?: string;
}

export interface DeviceCapabilities {
  maxConnections: number;
  compressionEnabled: boolean;
  relayEnabled: boolean;
  natTraversalEnabled: boolean;
  protocolVersion: string;
}

export interface SyncStatus {
  state: 'idle' | 'scanning' | 'syncing' | 'paused' | 'error' | 'conflict';
  progress?: number;
  currentFile?: string;
  totalFiles?: number;
  completedFiles?: number;
  bytesTransferred?: number;
  totalBytes?: number;
  errors?: SyncError[];
  conflicts?: ConflictInfo[];
  events?: SyncEvent[];
}

export interface SyncError {
  id: string;
  type: 'permission' | 'network' | 'disk' | 'conflict' | 'unknown';
  message: string;
  filePath?: string;
  timestamp: Date;
  retryable: boolean;
  retryCount: number;
}

export interface ConflictInfo {
  id: string;
  filePath: string;
  folderId?: string;
  localVersion: FileVersion;
  remoteVersion: FileVersion;
  detectedAt: Date;
  resolved: boolean;
  resolution?: 'local' | 'remote' | 'both' | 'manual';
  resolvedAt?: Date;
}

export interface FileVersion {
  id: string;
  hash: string;
  size: number;
  modifiedAt: Date;
  modifiedBy: string;
  deviceId: string;
  deviceName: string;
}

export interface FileInfo {
  path: string;
  relativePath: string;
  name: string;
  size: number;
  type: 'file' | 'directory' | 'symlink';
  hash?: string;
  modifiedAt: Date;
  createdAt: Date;
  permissions?: number;
  isIgnored: boolean;
  versions?: FileVersion[];
}

export interface FolderStats {
  totalFiles: number;
  totalDirectories: number;
  totalSize: number;
  ignoredFiles: number;
  lastScanAt?: Date;
  scanDuration?: number;
}

export interface VersioningPolicy {
  type: 'simple' | 'time-based' | 'none';
  keepVersions?: number;
  keepDays?: number;
  cleanupInterval?: number;
  minDiskSpace?: number;
}

export interface SyncEvent {
  id: string;
  type: SyncEventType;
  folderId: string;
  filePath?: string;
  deviceId?: string;
  timestamp: Date;
  data?: any;
}

export type SyncEventType =
  | 'file-added'
  | 'file-modified'
  | 'file-deleted'
  | 'file-renamed'
  | 'folder-added'
  | 'folder-deleted'
  | 'conflict-detected'
  | 'conflict-resolved'
  | 'sync-started'
  | 'sync-completed'
  | 'sync-failed'
  | 'device-connected'
  | 'device-disconnected';

export interface TransferProgress {
  fileId: string;
  fileName: string;
  fromDevice: string;
  toDevice: string;
  bytesTransferred: number;
  totalBytes: number;
  speed: number;
  eta: number;
  startedAt: Date;
  completedAt?: Date;
}

export interface PairingRequest {
  deviceId: string;
  deviceName: string;
  platform: string;
  timestamp: Date;
  expires: Date;
  code: string;
  publicKey: string;
}

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  modifiedAt: string;
  hash?: string;
  children?: FileEntry[];
}
