import { EventEmitter } from 'events';
import Store from 'electron-store';
import PQueue from 'p-queue';
import { v4 as uuidv4 } from 'uuid';
import { FileWatcher, FileChangeEvent } from './fileWatcher';
import { NetworkManager } from '../network/networkManager';
import { ConflictResolver } from './conflictResolver';
import { VersionManager } from './versionManager';
import { TransferManager } from './transferManager';
import {
  FolderConfig,
  SyncStatus,
  SyncError,
  FileInfo,
  ConflictInfo,
  SyncEvent,
} from '../../shared/types/sync';
import { AppConfig } from '../../shared/types/config';
import { logger } from '../utils/logger';

export class SyncEngine extends EventEmitter {
  private syncQueues: Map<string, PQueue> = new Map();
  private folderStatuses: Map<string, SyncStatus> = new Map();
  private conflictResolver: ConflictResolver;
  private versionManager: VersionManager;
  private transferManager: TransferManager;
  private syncInProgress: Set<string> = new Set();
  private pausedFolders: Set<string> = new Set();
  private initialized = false;

  constructor(
    private store: Store<AppConfig>,
    private fileWatcher: FileWatcher,
    private networkManager: NetworkManager
  ) {
    super();

    this.conflictResolver = new ConflictResolver(store);
    this.versionManager = new VersionManager(store);
    this.transferManager = new TransferManager(store, networkManager);

    this.setupEventHandlers();
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Initialize version manager
      await this.versionManager.initialize();

      // Initialize transfer manager
      await this.transferManager.initialize();

      // Start watching existing folders
      const folders = this.store.get('folders');
      for (const folder of folders) {
        await this.initializeFolder(folder);
      }

      this.initialized = true;
      logger.info('Sync engine initialized');
    } catch (error) {
      logger.error('Failed to initialize sync engine:', error);
      throw error;
    }
  }

  private setupEventHandlers(): void {
    // Handle file changes from watcher
    this.fileWatcher.on('file-change', (event: FileChangeEvent) => {
      this.handleFileChange(event);
    });

    // Handle network events
    this.networkManager.on('device-connected', (deviceId: string) => {
      this.handleDeviceConnected(deviceId);
    });

    this.networkManager.on('device-disconnected', (deviceId: string) => {
      this.handleDeviceDisconnected(deviceId);
    });

    // Handle transfer events
    this.transferManager.on('transfer-progress', (progress) => {
      this.emit('sync-progress', progress);
    });

    this.transferManager.on('transfer-complete', (transfer) => {
      this.emit('transfer-complete', transfer);
    });

    this.transferManager.on('transfer-error', (error) => {
      this.emit('transfer-error', error);
    });
  }

  private async initializeFolder(folder: FolderConfig): Promise<void> {
    try {
      // Create sync queue for this folder
      const queue = new PQueue({
        concurrency: this.store.get('performance.maxConcurrentTransfers') || 3,
        interval: 1000,
        intervalCap: 10,
      });
      this.syncQueues.set(folder.id, queue);

      // Initialize folder status
      this.folderStatuses.set(folder.id, {
        state: 'idle',
        progress: 0,
        totalFiles: 0,
        completedFiles: 0,
        bytesTransferred: 0,
        totalBytes: 0,
        errors: [],
        conflicts: [],
      });

      // Start watching folder
      await this.fileWatcher.watchFolder(folder);

      // Perform initial scan
      await this.scanFolder(folder.id);

      logger.info(`Initialized folder: ${folder.path}`);
    } catch (error) {
      logger.error(`Failed to initialize folder ${folder.path}:`, error);
      this.updateFolderStatus(folder.id, {
        state: 'error',
        errors: [
          {
            id: uuidv4(),
            type: 'unknown',
            message: `Failed to initialize folder: ${(error as Error).message}`,
            timestamp: new Date(),
            retryable: true,
            retryCount: 0,
          },
        ],
      });
    }
  }

  async addFolder(folder: FolderConfig): Promise<void> {
    await this.initializeFolder(folder);
    await this.syncNow(folder.id);
  }

  async removeFolder(folderId: string): Promise<void> {
    // Stop watching
    await this.fileWatcher.unwatchFolder(folderId);

    // Cancel pending operations
    const queue = this.syncQueues.get(folderId);
    if (queue) {
      queue.clear();
      await queue.onIdle();
      this.syncQueues.delete(folderId);
    }

    // Clean up status
    this.folderStatuses.delete(folderId);
    this.syncInProgress.delete(folderId);
    this.pausedFolders.delete(folderId);

    logger.info(`Removed folder: ${folderId}`);
  }

  async refreshIgnorePatterns(folderId: string): Promise<void> {
    await this.syncFolder(folderId);
  }

  async syncNow(folderId?: string): Promise<void> {
    if (folderId) {
      await this.syncFolder(folderId);
    } else {
      // Sync all folders
      const folders = this.store.get('folders');
      await Promise.all(folders.map((folder) => this.syncFolder(folder.id)));
    }
  }

  private async syncFolder(folderId: string): Promise<void> {
    if (this.syncInProgress.has(folderId) || this.pausedFolders.has(folderId)) {
      return;
    }

    const folder = this.store.get('folders').find((f) => f.id === folderId);
    if (!folder) {
      logger.error(`Folder not found: ${folderId}`);
      return;
    }

    this.syncInProgress.add(folderId);
    this.updateFolderStatus(folderId, { state: 'scanning' });

    try {
      // Scan local files
      const localFiles = await this.fileWatcher.scanFolder(folder);

      // Get remote file list from connected devices
      const remoteFiles = await this.getRemoteFiles(folder);

      // Compare and determine sync actions
      const syncActions = await this.determineSyncActions(folder, localFiles, remoteFiles);

      if (syncActions.length === 0) {
        this.updateFolderStatus(folderId, { state: 'idle' });
        this.syncInProgress.delete(folderId);
        return;
      }

      // Update status
      this.updateFolderStatus(folderId, {
        state: 'syncing',
        totalFiles: syncActions.length,
        completedFiles: 0,
        progress: 0,
      });

      // Execute sync actions
      const queue = this.syncQueues.get(folderId)!;
      let completed = 0;

      for (const action of syncActions) {
        await queue.add(async () => {
          try {
            await this.executeSyncAction(folder, action);
            completed++;

            this.updateFolderStatus(folderId, {
              completedFiles: completed,
              progress: (completed / syncActions.length) * 100,
            });
          } catch (error) {
            logger.error(`Sync action failed:`, error);
            this.addSyncError(folderId, error);
          }
        });
      }

      // Wait for all sync actions to complete
      await queue.onIdle();

      // Update status
      this.updateFolderStatus(folderId, { state: 'idle' });
      this.emit('sync-complete', { folderId });
    } catch (error) {
      logger.error(`Sync failed for folder ${folderId}:`, error);
      this.updateFolderStatus(folderId, { state: 'error' });
      this.addSyncError(folderId, error);
    } finally {
      this.syncInProgress.delete(folderId);
    }
  }

  private async scanFolder(folderId: string): Promise<void> {
    const folder = this.store.get('folders').find((f) => f.id === folderId);
    if (!folder) return;

    try {
      const files = await this.fileWatcher.scanFolder(folder);
      logger.info(`Scanned ${files.length} files in folder ${folder.path}`);

      // Update folder stats
      const stats = {
        totalFiles: files.filter((f) => f.type === 'file').length,
        totalDirectories: files.filter((f) => f.type === 'directory').length,
        totalSize: files.reduce((sum, f) => sum + (f.size || 0), 0),
        ignoredFiles: files.filter((f) => f.isIgnored).length,
        lastScanAt: new Date(),
        scanDuration: 0,
      };

      // Update folder in store
      const folders = this.store.get('folders');
      const updatedFolders = folders.map((f) => (f.id === folderId ? { ...f, stats } : f));
      this.store.set('folders', updatedFolders);
    } catch (error) {
      logger.error(`Failed to scan folder ${folderId}:`, error);
      throw error;
    }
  }

  private async getRemoteFiles(folder: FolderConfig): Promise<Map<string, FileInfo[]>> {
    const remoteFiles = new Map<string, FileInfo[]>();
    const connectedDevices = this.networkManager.getConnectedDevices();

    for (const deviceId of folder.devices) {
      if (connectedDevices.has(deviceId)) {
        try {
          const files = await this.networkManager.requestFileList(deviceId, folder.id);
          remoteFiles.set(deviceId, files);
        } catch (error) {
          logger.error(`Failed to get file list from device ${deviceId}:`, error);
        }
      }
    }

    return remoteFiles;
  }

  private async determineSyncActions(
    folder: FolderConfig,
    localFiles: FileInfo[],
    remoteFiles: Map<string, FileInfo[]>
  ): Promise<SyncAction[]> {
    const actions: SyncAction[] = [];
    const localFileMap = new Map(localFiles.map((f) => [f.relativePath, f]));

    // Check each remote device
    for (const [deviceId, deviceFiles] of remoteFiles) {
      const remoteFileMap = new Map(deviceFiles.map((f) => [f.relativePath, f]));

      // Files to download (exist on remote but not local)
      for (const [path, remoteFile] of remoteFileMap) {
        const localFile = localFileMap.get(path);

        if (!localFile) {
          // File doesn't exist locally - download it
          if (folder.mode === 'send-receive' || folder.mode === 'receive-only') {
            actions.push({
              type: 'download',
              path,
              fromDevice: deviceId,
              file: remoteFile,
            });
          }
        } else if (remoteFile.hash && localFile.hash && remoteFile.hash !== localFile.hash) {
          // File exists but has different content
          if (remoteFile.modifiedAt > localFile.modifiedAt) {
            // Remote file is newer
            if (folder.mode === 'send-receive' || folder.mode === 'receive-only') {
              actions.push({
                type: 'download',
                path,
                fromDevice: deviceId,
                file: remoteFile,
              });
            }
          } else if (remoteFile.modifiedAt < localFile.modifiedAt) {
            // Local file is newer
            if (folder.mode === 'send-receive') {
              actions.push({
                type: 'upload',
                path,
                toDevice: deviceId,
                file: localFile,
              });
            }
          } else {
            // Same modification time but different content - conflict!
            const conflict: ConflictInfo = {
              id: uuidv4(),
              filePath: path,
              folderId: folder.id,
              localVersion: {
                id: uuidv4(),
                hash: localFile.hash!,
                size: localFile.size,
                modifiedAt: localFile.modifiedAt,
                modifiedBy: 'local',
                deviceId: 'local',
                deviceName:
                  this.store.get('devices').find((d) => d.id === 'local')?.name || 'This Device',
              },
              remoteVersion: {
                id: uuidv4(),
                hash: remoteFile.hash!,
                size: remoteFile.size,
                modifiedAt: remoteFile.modifiedAt,
                modifiedBy: 'remote',
                deviceId,
                deviceName:
                  this.store.get('devices').find((d) => d.id === deviceId)?.name || deviceId,
              },
              detectedAt: new Date(),
              resolved: false,
            };

            this.addConflict(folder.id, conflict);
          }
        }
      }

      // Files to upload (exist locally but not on remote)
      if (folder.mode === 'send-receive') {
        for (const [path, localFile] of localFileMap) {
          if (!remoteFileMap.has(path) && localFile.type === 'file') {
            actions.push({
              type: 'upload',
              path,
              toDevice: deviceId,
              file: localFile,
            });
          }
        }
      }
    }

    return actions;
  }

  private async executeSyncAction(folder: FolderConfig, action: SyncAction): Promise<void> {
    const event: SyncEvent = {
      id: uuidv4(),
      type: action.type === 'download' ? 'file-modified' : 'file-modified',
      folderId: folder.id,
      filePath: action.path,
      deviceId: action.type === 'download' ? action.fromDevice : action.toDevice,
      timestamp: new Date(),
    };

    try {
      if (action.type === 'download') {
        await this.transferManager.downloadFile(folder, action.file, action.fromDevice!);
      } else if (action.type === 'upload') {
        await this.transferManager.uploadFile(folder, action.file, action.toDevice!);
      }

      this.emit('sync-event', event);
    } catch (error) {
      logger.error(`Failed to execute sync action:`, error);
      throw error;
    }
  }

  private handleFileChange(event: FileChangeEvent): void {
    if (this.pausedFolders.has(event.folderId)) {
      return;
    }

    // Queue sync for this folder
    const queue = this.syncQueues.get(event.folderId);
    if (queue) {
      queue.add(() => this.syncFolder(event.folderId));
    }
  }

  private handleDeviceConnected(deviceId: string): void {
    // Sync all folders that include this device
    const folders = this.store.get('folders');
    folders
      .filter((folder) => folder.devices.includes(deviceId))
      .forEach((folder) => this.syncFolder(folder.id));
  }

  private handleDeviceDisconnected(deviceId: string): void {
    // Update folder statuses
    const folders = this.store.get('folders');
    folders
      .filter((folder) => folder.devices.includes(deviceId))
      .forEach((folder) => {
        const status = this.folderStatuses.get(folder.id);
        if (status && status.state === 'syncing') {
          this.updateFolderStatus(folder.id, { state: 'idle' });
        }
      });
  }

  pauseSync(folderId?: string): void {
    if (folderId) {
      this.pausedFolders.add(folderId);
      this.updateFolderStatus(folderId, { state: 'paused' });
      logger.info(`Paused sync for folder: ${folderId}`);
    } else {
      // Pause all folders
      const folders = this.store.get('folders');
      folders.forEach((folder) => {
        this.pausedFolders.add(folder.id);
        this.updateFolderStatus(folder.id, { state: 'paused' });
      });
      logger.info('Paused all folder sync');
    }
  }

  resumeSync(folderId?: string): void {
    if (folderId) {
      this.pausedFolders.delete(folderId);
      this.updateFolderStatus(folderId, { state: 'idle' });
      this.syncFolder(folderId);
      logger.info(`Resumed sync for folder: ${folderId}`);
    } else {
      // Resume all folders
      const folders = this.store.get('folders');
      folders.forEach((folder) => {
        this.pausedFolders.delete(folder.id);
        this.updateFolderStatus(folder.id, { state: 'idle' });
        this.syncFolder(folder.id);
      });
      logger.info('Resumed all folder sync');
    }
  }

  togglePauseAll(): void {
    const allPaused = this.pausedFolders.size === this.store.get('folders').length;
    if (allPaused) {
      this.resumeSync();
    } else {
      this.pauseSync();
    }
  }

  private updateFolderStatus(folderId: string, updates: Partial<SyncStatus>): void {
    const currentStatus = this.folderStatuses.get(folderId) || {
      state: 'idle',
      progress: 0,
      errors: [],
      conflicts: [],
    };

    const newStatus = { ...currentStatus, ...updates };
    this.folderStatuses.set(folderId, newStatus);

    this.emit('status-changed', { folderId, status: newStatus });
  }

  private addSyncError(folderId: string, error: any): void {
    const status = this.folderStatuses.get(folderId);
    if (status) {
      const syncError: SyncError = {
        id: uuidv4(),
        type: 'unknown',
        message: error.message || 'Unknown error',
        timestamp: new Date(),
        retryable: true,
        retryCount: 0,
      };

      status.errors = [...(status.errors || []), syncError];
      this.emit('sync-error', { folderId, error: syncError });
    }
  }

  private addConflict(folderId: string, conflict: ConflictInfo): void {
    const status = this.folderStatuses.get(folderId);
    if (status) {
      status.conflicts = [...(status.conflicts || []), conflict];
      this.updateFolderStatus(folderId, { state: 'conflict' });
      this.emit('conflict-detected', { folderId, conflict });
    }
  }

  getSyncStatus(folderId?: string): SyncStatus | Map<string, SyncStatus> {
    if (folderId) {
      return (
        this.folderStatuses.get(folderId) || {
          state: 'idle',
          progress: 0,
          errors: [],
          conflicts: [],
        }
      );
    }
    return new Map(this.folderStatuses);
  }

  async resolveConflict(
    conflictId: string,
    resolution: 'local' | 'remote' | 'both'
  ): Promise<void> {
    // Find the conflict
    let foundFolderId: string | null = null;
    let foundConflict: ConflictInfo | null = null;

    for (const [folderId, status] of this.folderStatuses) {
      const conflict = status.conflicts?.find((c) => c.id === conflictId);
      if (conflict) {
        foundFolderId = folderId;
        foundConflict = conflict;
        break;
      }
    }

    if (!foundFolderId || !foundConflict) {
      throw new Error('Conflict not found');
    }

    await this.conflictResolver.resolveConflict(foundConflict, resolution);

    // Update status
    const status = this.folderStatuses.get(foundFolderId)!;
    status.conflicts = status.conflicts?.filter((c) => c.id !== conflictId) || [];

    if (status.conflicts.length === 0 && status.state === 'conflict') {
      this.updateFolderStatus(foundFolderId, { state: 'idle' });
    }

    // Resync folder
    await this.syncFolder(foundFolderId);
  }

  async stop(): Promise<void> {
    // Cancel all pending operations
    for (const [, queue] of this.syncQueues) {
      queue.clear();
      await queue.onIdle();
    }

    this.syncQueues.clear();
    this.folderStatuses.clear();
    this.syncInProgress.clear();
    this.pausedFolders.clear();

    await this.versionManager.cleanup();
    await this.transferManager.stop();

    logger.info('Sync engine stopped');
  }
}

interface SyncAction {
  type: 'download' | 'upload';
  path: string;
  fromDevice?: string;
  toDevice?: string;
  file: FileInfo;
}
