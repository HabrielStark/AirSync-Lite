import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { Hashing } from '../watcher/Hashing';
import { filterVersions, VersionRetentionPolicy } from './RetentionPolicy';
import { InMemoryMetadataStore, MetadataStore, VersionMetadata } from './MetadataStore';

export interface VersionManagerOptions {
  storagePath: string;
  policy: VersionRetentionPolicy;
  metadataStore?: MetadataStore;
}

export class VersionManager {
  private readonly hashing: Hashing;
  private readonly metadataStore: MetadataStore;

  constructor(private readonly options: VersionManagerOptions) {
    this.hashing = new Hashing({ algorithm: 'sha256', blockSize: 64 * 1024 });
    this.metadataStore = options.metadataStore ?? new InMemoryMetadataStore();
  }

  async snapshot(filePath: string): Promise<VersionMetadata> {
    const hash = await this.hashing.hashFile(filePath);
    const version: VersionMetadata = {
      id: uuidv4(),
      filePath,
      hash: hash.hash,
      createdAt: Date.now(),
      size: hash.size,
      storedPath: await this.persist(filePath, hash.hash),
    };

    await this.metadataStore.save(version);
    await this.applyRetention(filePath);
    return version;
  }

  async list(filePath: string): Promise<VersionMetadata[]> {
    return this.metadataStore.list(filePath);
  }

  async restore(versionId: string, targetPath: string): Promise<void> {
    const metadata = await (this.metadataStore as any).getById?.(versionId);
    if (!metadata) {
      throw new Error(`Version ${versionId} not found`);
    }

    await fs.copyFile(metadata.storedPath, targetPath);
  }

  private async applyRetention(filePath: string): Promise<void> {
    const versions = await this.metadataStore.list(filePath);
    const retained = filterVersions(versions, this.options.policy);
    const retainedIds = new Set(retained.map((v) => v.id));

    for (const version of versions) {
      if (!retainedIds.has(version.id)) {
        await this.cleanupVersion(version);
        await this.metadataStore.delete(version.id);
      }
    }
  }

  private async persist(filePath: string, hash: string): Promise<string> {
    const targetDir = path.join(this.options.storagePath, hash.slice(0, 2));
    await fs.mkdir(targetDir, { recursive: true });
    const targetPath = path.join(targetDir, hash);
    await fs.copyFile(filePath, targetPath);
    return targetPath;
  }

  private async cleanupVersion(version: VersionMetadata): Promise<void> {
    await fs.unlink(version.storedPath).catch(() => undefined);
  }
}
