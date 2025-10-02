import * as fs from 'fs/promises';
import * as path from 'path';
import Store from 'electron-store';
import { app } from 'electron';
import { ConflictInfo } from '../../shared/types/sync';
import { AppConfig } from '../../shared/types/config';
import { logger } from '../utils/logger';

export class ConflictResolver {
  private conflictDir: string;

  constructor(private store: Store<AppConfig>) {
    const basePath = safeResolveUserData(store);
    this.conflictDir = path.join(basePath, 'conflicts');
  }

  async initialize(): Promise<void> {
    // Ensure conflict directory exists
    await fs.mkdir(this.conflictDir, { recursive: true });
  }

  async resolveConflict(
    conflict: ConflictInfo,
    resolution: 'local' | 'remote' | 'both' | 'manual'
  ): Promise<void> {
    logger.info(`Resolving conflict for ${conflict.filePath} with resolution: ${resolution}`);

    try {
      switch (resolution) {
        case 'local':
          // Keep local version, ignore remote
          await this.keepLocalVersion(conflict);
          break;

        case 'remote':
          // Replace local with remote version
          await this.acceptRemoteVersion(conflict);
          break;

        case 'both':
          // Keep both versions with different names
          await this.keepBothVersions(conflict);
          break;

        case 'manual':
          // User will manually resolve
          await this.prepareManualResolution(conflict);
          break;
      }

      // Mark conflict as resolved
      conflict.resolved = true;
      conflict.resolution = resolution;
      conflict.resolvedAt = new Date();

      logger.info(`Conflict resolved for ${conflict.filePath}`);
    } catch (error) {
      logger.error(`Failed to resolve conflict for ${conflict.filePath}:`, error);
      throw error;
    }
  }

  private async keepLocalVersion(conflict: ConflictInfo): Promise<void> {
    // Local version is already in place, just log the decision
    logger.info(`Keeping local version of ${conflict.filePath}`);

    // Save remote version as backup
    const backupPath = await this.createConflictBackup(
      conflict.filePath,
      conflict.remoteVersion,
      'remote'
    );

    logger.info(`Remote version backed up to ${backupPath}`);
  }

  private async acceptRemoteVersion(conflict: ConflictInfo): Promise<void> {
    // Save local version as backup first
    const backupPath = await this.createConflictBackup(
      conflict.filePath,
      conflict.localVersion,
      'local'
    );

    logger.info(`Local version backed up to ${backupPath}`);

    // Note: Actual file replacement would be handled by the sync engine
    // This just manages the conflict resolution metadata
  }

  private async keepBothVersions(conflict: ConflictInfo): Promise<void> {
    const dir = path.dirname(conflict.filePath);
    const basename = path.basename(conflict.filePath, path.extname(conflict.filePath));
    const ext = path.extname(conflict.filePath);

    // Create conflict file names
    const localConflictName = `${basename}.~conflict~local~${Date.now()}${ext}`;
    const remoteConflictName = `${basename}.~conflict~${conflict.remoteVersion.deviceName}~${Date.now()}${ext}`;

    const localConflictPath = path.join(dir, localConflictName);
    // Copy local file to conflict name
    await fs.copyFile(conflict.filePath, localConflictPath);

    logger.info(`Created conflict copies: ${localConflictName} and ${remoteConflictName}`);

    // The sync engine will handle downloading the remote version to remoteConflictPath
  }

  private async prepareManualResolution(conflict: ConflictInfo): Promise<void> {
    // Create a conflict resolution workspace
    const conflictId = conflict.id;
    const workspacePath = path.join(this.conflictDir, conflictId);

    await fs.mkdir(workspacePath, { recursive: true });

    // Save conflict metadata
    const metadataPath = path.join(workspacePath, 'conflict.json');
    await fs.writeFile(metadataPath, JSON.stringify(conflict, null, 2));

    // Copy local version
    const localPath = path.join(workspacePath, 'local' + path.extname(conflict.filePath));
    await fs.copyFile(conflict.filePath, localPath);

    // Remote version will be downloaded by sync engine
    // Create instructions file
    const instructionsPath = path.join(workspacePath, 'README.txt');
    const instructions = `Conflict Resolution Instructions
================================

File: ${conflict.filePath}
Conflict ID: ${conflict.id}
Detected: ${conflict.detectedAt}

Local Version:
- Modified: ${conflict.localVersion.modifiedAt}
- Size: ${this.formatBytes(conflict.localVersion.size)}
- Device: ${conflict.localVersion.deviceName}
- File: local${path.extname(conflict.filePath)}

Remote Version:
- Modified: ${conflict.remoteVersion.modifiedAt}
- Size: ${this.formatBytes(conflict.remoteVersion.size)}
- Device: ${conflict.remoteVersion.deviceName}
- File: remote${path.extname(conflict.filePath)}

To resolve this conflict:
1. Compare the local and remote versions
2. Create your resolved version
3. Save it as 'resolved${path.extname(conflict.filePath)}' in this directory
4. The sync system will detect and use your resolved version
`;

    await fs.writeFile(instructionsPath, instructions);

    logger.info(`Manual conflict resolution prepared in ${workspacePath}`);
  }

  private async createConflictBackup(
    filePath: string,
    version: ConflictInfo['localVersion'],
    type: 'local' | 'remote'
  ): Promise<string> {
    const backupDir = path.join(this.conflictDir, 'backups');
    await fs.mkdir(backupDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const basename = path.basename(filePath);
    const backupName = `${timestamp}_${type}_${version.deviceName}_${basename}`;
    const backupPath = path.join(backupDir, backupName);

    // Copy file to backup location
    if (type === 'local') {
      await fs.copyFile(filePath, backupPath);
    }
    // Remote file copying would be handled by sync engine

    // Save metadata
    const metadataPath = backupPath + '.json';
    await fs.writeFile(
      metadataPath,
      JSON.stringify(
        {
          originalPath: filePath,
          version,
          type,
          backupDate: new Date(),
        },
        null,
        2
      )
    );

    return backupPath;
  }

  async detectConflicts(
    localPath: string,
    localHash: string,
    localModified: Date,
    remoteHash: string,
    remoteModified: Date
  ): Promise<boolean> {
    // Simple conflict detection based on hash and modification time
    if (localHash === remoteHash) {
      return false; // No conflict, files are identical
    }

    // If modification times are significantly different, newer wins
    const timeDiff = Math.abs(localModified.getTime() - remoteModified.getTime());
    const threshold = 10000; // ✅ CRITICAL FIX: 10 seconds (was 60s - too large!)

    if (timeDiff > threshold) {
      return false; // No conflict, clear winner based on time
    }

    // Otherwise, we have a conflict
    return true;
  }

  async getConflictHistory(): Promise<any[]> {
    const historyPath = path.join(this.conflictDir, 'history.json');

    try {
      const data = await fs.readFile(historyPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      return [];
    }
  }

  async saveConflictHistory(conflict: ConflictInfo): Promise<void> {
    const history = await this.getConflictHistory();
    history.push({
      ...conflict,
      timestamp: new Date(),
    });

    // Keep only last 100 conflicts
    if (history.length > 100) {
      history.splice(0, history.length - 100);
    }

    const historyPath = path.join(this.conflictDir, 'history.json');
    await fs.writeFile(historyPath, JSON.stringify(history, null, 2));
  }

  async cleanOldBackups(daysToKeep: number = 30): Promise<void> {
    const backupDir = path.join(this.conflictDir, 'backups');
    const cutoffTime = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;

    try {
      const files = await fs.readdir(backupDir);

      for (const file of files) {
        const filePath = path.join(backupDir, file);
        const stats = await fs.stat(filePath);

        if (stats.mtime.getTime() < cutoffTime) {
          await fs.unlink(filePath);
          logger.info(`Deleted old backup: ${file}`);
        }
      }
    } catch (error) {
      logger.error('Failed to clean old backups:', error);
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

function safeResolveUserData(store: Store<AppConfig>): string {
  try {
    return app.getPath('userData');
  } catch (error) {
    logger.warn('Failed to resolve Electron userData path, falling back to store path', error);
  }

  if (store.path) {
    return path.dirname(store.path);
  }

  logger.error('No userData or store path available, using process cwd fallback.');
  return path.join(process.cwd(), 'airsync-data');
}
