export interface VersionMetadata {
  id: string;
  filePath: string;
  hash: string;
  createdAt: number;
  size: number;
  storedPath: string;
}

export interface MetadataStore {
  save(metadata: VersionMetadata): Promise<void>;
  list(filePath: string): Promise<VersionMetadata[]>;
  delete(id: string): Promise<void>;
  // ✅ FIX: Add missing method used in VersionManager
  getById(id: string): Promise<VersionMetadata | undefined>;
  getTotalSize(): Promise<number>;
  getOldestVersions(count: number): Promise<VersionMetadata[]>;
  deleteByFilePath(filePath: string): Promise<void>;
}

export class InMemoryMetadataStore implements MetadataStore {
  private readonly store = new Map<string, VersionMetadata[]>();

  async save(metadata: VersionMetadata): Promise<void> {
    const entries = this.store.get(metadata.filePath) ?? [];
    entries.push(metadata);
    this.store.set(metadata.filePath, entries);
  }

  async list(filePath: string): Promise<VersionMetadata[]> {
    return this.store.get(filePath) ?? [];
  }

  async delete(id: string): Promise<void> {
    for (const [filePath, versions] of this.store.entries()) {
      this.store.set(
        filePath,
        versions.filter((version) => version.id !== id)
      );
    }
  }

  // ✅ FIX: Implement missing methods
  async getById(id: string): Promise<VersionMetadata | undefined> {
    for (const versions of this.store.values()) {
      const found = versions.find((v) => v.id === id);
      if (found) return found;
    }
    return undefined;
  }

  async getTotalSize(): Promise<number> {
    let total = 0;
    for (const versions of this.store.values()) {
      for (const version of versions) {
        total += version.size;
      }
    }
    return total;
  }

  async getOldestVersions(count: number): Promise<VersionMetadata[]> {
    const allVersions: VersionMetadata[] = [];
    for (const versions of this.store.values()) {
      allVersions.push(...versions);
    }
    return allVersions.sort((a, b) => a.createdAt - b.createdAt).slice(0, count);
  }

  async deleteByFilePath(filePath: string): Promise<void> {
    this.store.delete(filePath);
  }
}
