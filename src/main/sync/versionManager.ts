import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { app } from 'electron';
import Store from 'electron-store';
import { v4 as uuidv4 } from 'uuid';
import { FileVersion, VersioningPolicy } from '../../shared/types/sync';
import { AppConfig } from '../../shared/types/config';
import { logger } from '../utils/logger';

interface VersionedFile {
  originalPath: string;
  versions: FileVersion[];
  currentVersion: string;
}

export class VersionManager {
  private versionsDir: string;
  private versionDb: Map<string, VersionedFile> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(private store: Store<AppConfig>) {
    // ✅ CRITICAL FIX: Use Electron API for userData path
    this.versionsDir = path.join(app.getPath('userData'), 'versions');
  }

  async initialize(): Promise<void> {
    // Ensure versions directory exists
    await fs.mkdir(this.versionsDir, { recursive: true });

    // Load version database
    await this.loadVersionDatabase();

    // Start cleanup interval
    this.startCleanupSchedule();

    logger.info('Version manager initialized');
  }

  private async loadVersionDatabase(): Promise<void> {
    const dbPath = path.join(this.versionsDir, 'versions.db.json');

    try {
      const data = await fs.readFile(dbPath, 'utf8');
      const db = JSON.parse(data);

      for (const [path, file] of Object.entries(db)) {
        this.versionDb.set(path, file as VersionedFile);
      }

      logger.info(`Loaded ${this.versionDb.size} versioned files`);
    } catch (error) {
      // Database doesn't exist yet
      logger.info('No existing version database found');
    }
  }

  private async saveVersionDatabase(): Promise<void> {
    const dbPath = path.join(this.versionsDir, 'versions.db.json');
    const db: Record<string, VersionedFile> = {};

    for (const [path, file] of this.versionDb) {
      db[path] = file;
    }

    await fs.writeFile(dbPath, JSON.stringify(db, null, 2));
  }

  async createVersion(
    filePath: string,
    fileContent: Buffer,
    metadata: {
      hash: string;
      size: number;
      modifiedAt: Date;
      deviceId: string;
      deviceName: string;
    },
    policy: VersioningPolicy
  ): Promise<FileVersion> {
    const version: FileVersion = {
      id: uuidv4(),
      hash: metadata.hash,
      size: metadata.size,
      modifiedAt: metadata.modifiedAt,
      modifiedBy: metadata.deviceName,
      deviceId: metadata.deviceId,
      deviceName: metadata.deviceName,
    };

    // Get or create versioned file entry
    let versionedFile = this.versionDb.get(filePath);
    if (!versionedFile) {
      versionedFile = {
        originalPath: filePath,
        versions: [],
        currentVersion: version.id,
      };
      this.versionDb.set(filePath, versionedFile);
    }

    // Check if this version already exists
    const existingVersion = versionedFile.versions.find((v) => v.hash === version.hash);
    if (existingVersion) {
      logger.debug(`Version already exists for ${filePath} with hash ${version.hash}`);
      return existingVersion;
    }

    // Store version content
    const versionPath = this.getVersionPath(filePath, version.id);
    await fs.mkdir(path.dirname(versionPath), { recursive: true });
    await fs.writeFile(versionPath, fileContent);

    // Add to versions list
    versionedFile.versions.push(version);
    versionedFile.currentVersion = version.id;

    // Apply versioning policy
    await this.applyVersioningPolicy(versionedFile, policy);

    // Save database
    await this.saveVersionDatabase();

    logger.info(`Created version ${version.id} for ${filePath}`);
    return version;
  }

  private async applyVersioningPolicy(
    versionedFile: VersionedFile,
    policy: VersioningPolicy
  ): Promise<void> {
    if (policy.type === 'none') {
      // Keep only current version
      const currentVersion = versionedFile.versions.find(
        (v) => v.id === versionedFile.currentVersion
      );
      if (currentVersion) {
        // Delete all other versions
        for (const version of versionedFile.versions) {
          if (version.id !== currentVersion.id) {
            await this.deleteVersionFile(versionedFile.originalPath, version.id);
          }
        }
        versionedFile.versions = [currentVersion];
      }
    } else if (policy.type === 'simple' && policy.keepVersions) {
      // Keep only N most recent versions
      if (versionedFile.versions.length > policy.keepVersions) {
        // Sort by modification date, newest first
        versionedFile.versions.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());

        // Remove old versions
        const toRemove = versionedFile.versions.slice(policy.keepVersions);
        for (const version of toRemove) {
          await this.deleteVersionFile(versionedFile.originalPath, version.id);
        }

        versionedFile.versions = versionedFile.versions.slice(0, policy.keepVersions);
      }
    } else if (policy.type === 'time-based' && policy.keepDays) {
      // Keep versions from last N days
      const cutoffTime = Date.now() - policy.keepDays * 24 * 60 * 60 * 1000;

      const toKeep: FileVersion[] = [];
      const toRemove: FileVersion[] = [];

      for (const version of versionedFile.versions) {
        if (
          version.modifiedAt.getTime() >= cutoffTime ||
          version.id === versionedFile.currentVersion
        ) {
          toKeep.push(version);
        } else {
          toRemove.push(version);
        }
      }

      // Remove old versions
      for (const version of toRemove) {
        await this.deleteVersionFile(versionedFile.originalPath, version.id);
      }

      versionedFile.versions = toKeep;
    }
  }

  async getVersions(filePath: string): Promise<FileVersion[]> {
    const versionedFile = this.versionDb.get(filePath);
    if (!versionedFile) {
      return [];
    }

    // Sort by modification date, newest first
    return [...versionedFile.versions].sort(
      (a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime()
    );
  }

  async getVersion(filePath: string, versionId: string): Promise<Buffer | null> {
    const versionedFile = this.versionDb.get(filePath);
    if (!versionedFile) {
      return null;
    }

    const version = versionedFile.versions.find((v) => v.id === versionId);
    if (!version) {
      return null;
    }

    const versionPath = this.getVersionPath(filePath, versionId);

    try {
      return await fs.readFile(versionPath);
    } catch (error) {
      logger.error(`Failed to read version ${versionId} of ${filePath}:`, error);
      return null;
    }
  }

  async restoreVersion(filePath: string, versionId: string): Promise<void> {
    const versionContent = await this.getVersion(filePath, versionId);
    if (!versionContent) {
      throw new Error(`Version ${versionId} not found for ${filePath}`);
    }

    // Create backup of current file
    try {
      const currentContent = await fs.readFile(filePath);
      const currentStats = await fs.stat(filePath);

      await this.createVersion(
        filePath,
        currentContent,
        {
          hash: crypto.createHash('sha256').update(currentContent).digest('hex'),
          size: currentStats.size,
          modifiedAt: currentStats.mtime,
          deviceId: this.store.get('deviceId' as any) || 'local',
          deviceName: 'Local Backup Before Restore',
        },
        { type: 'simple', keepVersions: 1 } // Keep as backup
      );
    } catch (error) {
      logger.warn('Could not backup current file before restore:', error);
    }

    // Restore the version
    await fs.writeFile(filePath, versionContent);

    // Update current version
    const versionedFile = this.versionDb.get(filePath);
    if (versionedFile) {
      versionedFile.currentVersion = versionId;
      await this.saveVersionDatabase();
    }

    logger.info(`Restored version ${versionId} of ${filePath}`);
  }

  async compareVersions(
    filePath: string,
    versionId1: string,
    versionId2: string
  ): Promise<{
    version1: FileVersion | null;
    version2: FileVersion | null;
    differences: string[];
  }> {
    const versionedFile = this.versionDb.get(filePath);
    if (!versionedFile) {
      return { version1: null, version2: null, differences: [] };
    }

    const version1 = versionedFile.versions.find((v) => v.id === versionId1) || null;
    const version2 = versionedFile.versions.find((v) => v.id === versionId2) || null;

    const differences: string[] = [];

    if (version1 && version2) {
      if (version1.size !== version2.size) {
        differences.push(
          `Size: ${this.formatBytes(version1.size)} → ${this.formatBytes(version2.size)}`
        );
      }

      if (version1.hash !== version2.hash) {
        differences.push('Content changed');
      }

      const timeDiff = version2.modifiedAt.getTime() - version1.modifiedAt.getTime();
      differences.push(`Time difference: ${this.formatTimeDiff(timeDiff)}`);

      if (version1.deviceName !== version2.deviceName) {
        differences.push(`Device: ${version1.deviceName} → ${version2.deviceName}`);
      }
    }

    return { version1, version2, differences };
  }

  private getVersionPath(originalPath: string, versionId: string): string {
    const hash = crypto.createHash('sha256').update(originalPath).digest('hex');
    const ext = path.extname(originalPath);
    return path.join(
      this.versionsDir,
      hash.substring(0, 2),
      hash.substring(2, 4),
      `${hash}_${versionId}${ext}`
    );
  }

  private async deleteVersionFile(originalPath: string, versionId: string): Promise<void> {
    const versionPath = this.getVersionPath(originalPath, versionId);

    try {
      await fs.unlink(versionPath);
      logger.debug(`Deleted version file: ${versionPath}`);
    } catch (error) {
      logger.error(`Failed to delete version file: ${versionPath}`, error);
    }
  }

  private startCleanupSchedule(): void {
    // Run cleanup every hour
    this.cleanupInterval = setInterval(
      () => {
        this.performCleanup();
      },
      60 * 60 * 1000
    );

    // Also run cleanup on startup
    this.performCleanup();
  }

  private async performCleanup(): Promise<void> {
    logger.info('Starting version cleanup');

    const folders = this.store.get('folders');
    let cleaned = 0;

    for (const [filePath, versionedFile] of this.versionDb) {
      // Find the folder this file belongs to
      const folder = folders.find((f) => filePath.startsWith(f.path));
      if (!folder) {
        continue;
      }

      const beforeCount = versionedFile.versions.length;
      await this.applyVersioningPolicy(versionedFile, folder.versioningPolicy);
      const afterCount = versionedFile.versions.length;

      cleaned += beforeCount - afterCount;
    }

    // Clean up orphaned version files
    await this.cleanOrphanedVersions();

    // Check disk space
    await this.checkDiskSpace();

    await this.saveVersionDatabase();

    logger.info(`Version cleanup completed, removed ${cleaned} versions`);
  }

  private async cleanOrphanedVersions(): Promise<void> {
    // ✅ IMPLEMENTED: Scan versions directory and remove orphaned files
    try {
      const versionsDirExists = await fs
        .access(this.versionsDir)
        .then(() => true)
        .catch(() => false);
      if (!versionsDirExists) {
        return;
      }

      const allFiles = await fs.readdir(this.versionsDir, { recursive: true });
      const referencedFiles = new Set<string>();

      // Collect all referenced version file paths
      for (const file of this.versionDb.values()) {
        for (const version of file.versions) {
          // Build the expected stored path for this version
          const versionFileName = `${version.id}.dat`;
          const fileHash = crypto
            .createHash('sha256')
            .update(file.originalPath)
            .digest('hex')
            .substring(0, 8);
          const storedPath = path.join(this.versionsDir, fileHash, versionFileName);
          const relativePath = path.relative(this.versionsDir, storedPath);
          referencedFiles.add(relativePath);
        }
      }

      // Remove orphaned files
      let removedCount = 0;
      for (const file of allFiles) {
        if (typeof file === 'string' && !referencedFiles.has(file)) {
          try {
            const fullPath = path.join(this.versionsDir, file);
            const stats = await fs.stat(fullPath);
            if (stats.isFile()) {
              await fs.unlink(fullPath);
              removedCount++;
              logger.debug(`Removed orphaned version file: ${file}`);
            }
          } catch (error) {
            logger.warn(`Failed to remove orphaned file ${file}:`, error);
          }
        }
      }

      if (removedCount > 0) {
        logger.info(`Cleaned up ${removedCount} orphaned version files`);
      }
    } catch (error) {
      logger.error('Failed to clean orphaned versions:', error);
    }
  }

  private async checkDiskSpace(): Promise<void> {
    // ✅ CRITICAL FIX: Check DISK space, not RAM!
    try {
      const fsModule = await import('fs');
      const stats = fsModule.statfsSync ? fsModule.statfsSync(this.versionsDir) : null;

      let diskSpace: number;
      if (stats) {
        // Linux/macOS: use statfs
        diskSpace = (stats as any).bavail * (stats as any).bsize;
      } else {
        // Windows fallback: use diskusage library or skip check
        logger.warn('Disk space check not available on this platform');
        return;
      }

      const minSpace = 1024 * 1024 * 1024; // 1GB minimum
      if (diskSpace < minSpace) {
        logger.warn(
          `Low disk space (${Math.round(diskSpace / 1024 / 1024)}MB), performing aggressive cleanup`
        );

        // Remove oldest versions across all files
        const allVersions: { path: string; version: FileVersion }[] = [];

        for (const [path, file] of this.versionDb) {
          for (const version of file.versions) {
            if (version.id !== file.currentVersion) {
              allVersions.push({ path, version });
            }
          }
        }

        // Sort by age
        allVersions.sort((a, b) => a.version.modifiedAt.getTime() - b.version.modifiedAt.getTime());

        // Remove oldest 25%
        const toRemove = Math.floor(allVersions.length * 0.25);
        for (let i = 0; i < toRemove; i++) {
          const { path, version } = allVersions[i];
          await this.deleteVersionFile(path, version.id);

          const file = this.versionDb.get(path)!;
          file.versions = file.versions.filter((v) => v.id !== version.id);
        }
      }
    } catch (error) {
      logger.error('Failed to check disk space:', error);
    }
  }

  async getStorageStats(): Promise<{
    totalVersions: number;
    totalSize: number;
    fileCount: number;
    oldestVersion: Date | null;
    newestVersion: Date | null;
  }> {
    let totalVersions = 0;
    let totalSize = 0;
    let oldestVersion: Date | null = null;
    let newestVersion: Date | null = null;

    for (const file of this.versionDb.values()) {
      totalVersions += file.versions.length;

      for (const version of file.versions) {
        totalSize += version.size;

        if (!oldestVersion || version.modifiedAt < oldestVersion) {
          oldestVersion = version.modifiedAt;
        }

        if (!newestVersion || version.modifiedAt > newestVersion) {
          newestVersion = version.modifiedAt;
        }
      }
    }

    return {
      totalVersions,
      totalSize,
      fileCount: this.versionDb.size,
      oldestVersion,
      newestVersion,
    };
  }

  async cleanup(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    await this.saveVersionDatabase();
    logger.info('Version manager cleaned up');
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  private formatTimeDiff(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days} day${days !== 1 ? 's' : ''}`;
    if (hours > 0) return `${hours} hour${hours !== 1 ? 's' : ''}`;
    if (minutes > 0) return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
    return `${seconds} second${seconds !== 1 ? 's' : ''}`;
  }
}
