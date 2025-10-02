import { SQLiteMetadataStore } from '../../src/main/core/versioning/SQLiteMetadataStore';
import { VersionMetadata } from '../../src/main/core/versioning/MetadataStore';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('SQLiteMetadataStore', () => {
  let store: SQLiteMetadataStore;
  let tempDir: string;
  let dbPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlite-test-'));
    dbPath = path.join(tempDir, 'test.db');
    store = new SQLiteMetadataStore(dbPath);
  });

  afterEach(async () => {
    store.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const createTestMetadata = (id: string, filePath: string): VersionMetadata => ({
    id,
    filePath,
    hash: `hash-${id}`,
    createdAt: Date.now(),
    size: 1024,
    storedPath: `/versions/${id}`,
  });

  it('should save and retrieve version metadata', async () => {
    const metadata = createTestMetadata('v1', '/test/file.txt');
    
    await store.save(metadata);
    const versions = await store.list('/test/file.txt');

    expect(versions).toHaveLength(1);
    expect(versions[0].id).toBe('v1');
    expect(versions[0].filePath).toBe('/test/file.txt');
  });

  it('should handle multiple versions for same file', async () => {
    const v1 = createTestMetadata('v1', '/test/file.txt');
    const v2 = createTestMetadata('v2', '/test/file.txt');
    const v3 = createTestMetadata('v3', '/test/file.txt');

    await store.save(v1);
    await store.save(v2);
    await store.save(v3);

    const versions = await store.list('/test/file.txt');

    expect(versions).toHaveLength(3);
    expect(versions.map(v => v.id)).toContain('v1');
    expect(versions.map(v => v.id)).toContain('v2');
    expect(versions.map(v => v.id)).toContain('v3');
  });

  it('should list versions sorted by creation time (newest first)', async () => {
    const v1 = createTestMetadata('v1', '/test/file.txt');
    await new Promise(resolve => setTimeout(resolve, 10));
    const v2 = createTestMetadata('v2', '/test/file.txt');
    await new Promise(resolve => setTimeout(resolve, 10));
    const v3 = createTestMetadata('v3', '/test/file.txt');

    await store.save(v1);
    await store.save(v2);
    await store.save(v3);

    const versions = await store.list('/test/file.txt');

    expect(versions[0].id).toBe('v3');
    expect(versions[1].id).toBe('v2');
    expect(versions[2].id).toBe('v1');
  });

  it('should delete specific version', async () => {
    const v1 = createTestMetadata('v1', '/test/file.txt');
    const v2 = createTestMetadata('v2', '/test/file.txt');

    await store.save(v1);
    await store.save(v2);

    await store.delete('v1');

    const versions = await store.list('/test/file.txt');
    expect(versions).toHaveLength(1);
    expect(versions[0].id).toBe('v2');
  });

  it('should delete all versions for a file', async () => {
    const v1 = createTestMetadata('v1', '/test/file.txt');
    const v2 = createTestMetadata('v2', '/test/file.txt');
    const v3 = createTestMetadata('v3', '/other/file.txt');

    await store.save(v1);
    await store.save(v2);
    await store.save(v3);

    await store.deleteByFilePath('/test/file.txt');

    const versions1 = await store.list('/test/file.txt');
    const versions2 = await store.list('/other/file.txt');

    expect(versions1).toHaveLength(0);
    expect(versions2).toHaveLength(1);
  });

  it('should get version by ID', async () => {
    const metadata = createTestMetadata('v1', '/test/file.txt');
    
    await store.save(metadata);
    const retrieved = await store.getById('v1');

    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe('v1');
    expect(retrieved!.filePath).toBe('/test/file.txt');
  });

  it('should return undefined for non-existent version', async () => {
    const result = await store.getById('non-existent');
    expect(result).toBeUndefined();
  });

  it('should get oldest versions', async () => {
    const v1 = { ...createTestMetadata('v1', '/test/file1.txt'), createdAt: 1000 };
    const v2 = { ...createTestMetadata('v2', '/test/file2.txt'), createdAt: 2000 };
    const v3 = { ...createTestMetadata('v3', '/test/file3.txt'), createdAt: 3000 };

    await store.save(v1);
    await store.save(v2);
    await store.save(v3);

    const oldest = await store.getOldestVersions(2);

    expect(oldest).toHaveLength(2);
    expect(oldest[0].id).toBe('v1');
    expect(oldest[1].id).toBe('v2');
  });

  it('should calculate total size of all versions', async () => {
    const v1 = { ...createTestMetadata('v1', '/test/file1.txt'), size: 1000 };
    const v2 = { ...createTestMetadata('v2', '/test/file2.txt'), size: 2000 };
    const v3 = { ...createTestMetadata('v3', '/test/file3.txt'), size: 3000 };

    await store.save(v1);
    await store.save(v2);
    await store.save(v3);

    const totalSize = await store.getTotalSize();

    expect(totalSize).toBe(6000);
  });

  it('should persist data across instances', async () => {
    const metadata = createTestMetadata('v1', '/test/file.txt');
    
    await store.save(metadata);
    store.close();

    const newStore = new SQLiteMetadataStore(dbPath);
    const versions = await newStore.list('/test/file.txt');

    expect(versions).toHaveLength(1);
    expect(versions[0].id).toBe('v1');

    newStore.close();
  });

  it('should handle empty results gracefully', async () => {
    const versions = await store.list('/non-existent/file.txt');
    expect(versions).toEqual([]);

    const totalSize = await store.getTotalSize();
    expect(totalSize).toBe(0);
  });

  it('should handle special characters in file paths', async () => {
    const specialPath = '/test/файл с пробелами & специальными символами.txt';
    const metadata = createTestMetadata('v1', specialPath);

    await store.save(metadata);
    const versions = await store.list(specialPath);

    expect(versions).toHaveLength(1);
    expect(versions[0].filePath).toBe(specialPath);
  });
});
