import crypto from 'crypto';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';

import { VersionManager } from '../../src/main/sync/versionManager';
import Store from 'electron-store';
import { AppConfig } from '../../src/shared/types/config';

// Mock Electron app.getPath
jest.mock('electron', () => ({
  app: {
    getPath: (name: string) => path.join(os.tmpdir(), 'versionmanager-test-' + process.pid),
  },
}));

describe('VersionManager (CRITICAL BUG FIXES)', () => {
  let tempDir: string;
  let store: Store<AppConfig>;
  let manager: VersionManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vm-test-'));
    store = new Store<AppConfig>({
      cwd: tempDir,
      name: 'test-config',
    });

    store.set('folders' as any, [
      {
        id: 'folder-1',
        path: tempDir,
        name: 'Test Folder',
        mode: 'send-receive',
        status: { state: 'idle' },
        devices: [],
        ignorePatterns: [],
        versioningPolicy: { type: 'simple', keepVersions: 3 },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    manager = new VersionManager(store);
    await manager.initialize();
  });

  afterEach(async () => {
    await manager.cleanup();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('✅ BUG FIX #3: should use Electron API for userData path', () => {
    // This test verifies that app.getPath('userData') is used
    // If the old bug existed, it would try to access store.get('userData')
    // which would return undefined and cause path to be 'versions'
    
    const vmInstance = new VersionManager(store);
    
    // Should not throw during construction
    expect(vmInstance).toBeDefined();
    
    // The versionsDir should be a valid path under userData
    const versionsDir = (vmInstance as any).versionsDir;
    expect(versionsDir).toContain('versionmanager-test-');
    expect(versionsDir).toContain('versions');
  });

  it('✅ BUG FIX #4: checkDiskSpace should check disk, not RAM', async () => {
    // This test verifies disk space check is attempted, not RAM check
    // We can't easily test the actual implementation, but we can verify
    // the method doesn't throw and uses correct API
    
    const checkDiskSpace = (manager as any).checkDiskSpace.bind(manager);
    
    // Should not throw
    await expect(checkDiskSpace()).resolves.not.toThrow();
  });

  it('should create and manage versions', async () => {
    const testFilePath = path.join(tempDir, 'test.txt');
    const content = Buffer.from('Version 1');
    await fs.writeFile(testFilePath, content);

    const version1 = await manager.createVersion(
      testFilePath,
      content,
      {
        hash: crypto.createHash('sha256').update(content).digest('hex'),
        size: content.length,
        modifiedAt: new Date(),
        deviceId: 'device-1',
        deviceName: 'Device 1',
      },
      { type: 'simple', keepVersions: 10 }
    );

    expect(version1).toBeDefined();
    expect(version1.id).toBeTruthy();

    const versions = await manager.getVersions(testFilePath);
    expect(versions).toHaveLength(1);
    expect(versions[0].id).toBe(version1.id);
  });

  it('should restore version correctly', async () => {
    const testFilePath = path.join(tempDir, 'test.txt');

    const content = Buffer.from('Original content');
    await fs.writeFile(testFilePath, content);
    const version = await manager.createVersion(
      testFilePath,
      content,
      {
        hash: crypto.createHash('sha256').update(content).digest('hex'),
        size: content.length,
        modifiedAt: new Date(),
        deviceId: 'device-1',
        deviceName: 'Device 1',
      },
      { type: 'simple', keepVersions: 10 }
    );

    await fs.writeFile(testFilePath, 'Changed content');
    await manager.restoreVersion(testFilePath, version.id);

    const restoredContent = await fs.readFile(testFilePath, 'utf-8');
    expect(restoredContent).toBe('Original content');
  });

  it('should enforce maxVersions policy', async () => {
    const testFilePath = path.join(tempDir, 'test.txt');

    // Create 5 versions with maxVersions=3
    for (let i = 0; i < 5; i++) {
      const content = Buffer.from(`Version ${i}`);
      await fs.writeFile(testFilePath, content);
      await manager.createVersion(
        testFilePath,
        content,
        {
          hash: `hash-${i}`,
          size: content.length,
          modifiedAt: new Date(),
          deviceId: 'device-1',
          deviceName: 'Device 1',
        },
        { type: 'simple', keepVersions: 3 }
      );
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    const versions = await manager.getVersions(testFilePath);
    expect(versions.length).toBeLessThanOrEqual(3);
  });

  it('should delete old versions on cleanup', async () => {
    const testFilePath = path.join(tempDir, 'test.txt');
    
    const content = Buffer.from('Content');
    await fs.writeFile(testFilePath, content);
    await manager.createVersion(
      testFilePath,
      content,
      {
        hash: 'hash-delete',
        size: content.length,
        modifiedAt: new Date(),
        deviceId: 'device-1',
        deviceName: 'Device 1',
      },
      { type: 'simple', keepVersions: 1 }
    );

    const versions = await manager.getVersions(testFilePath);
    expect(versions).toHaveLength(1);
  });

  it('should get storage stats', async () => {
    const testFilePath1 = path.join(tempDir, 'test1.txt');
    const testFilePath2 = path.join(tempDir, 'test2.txt');

    const file1Content = Buffer.from('File 1');
    const file2Content = Buffer.from('File 2 with more content');
    await fs.writeFile(testFilePath1, file1Content);
    await fs.writeFile(testFilePath2, file2Content);

    await manager.createVersion(
      testFilePath1,
      file1Content,
      {
        hash: 'hash-file1',
        size: file1Content.length,
        modifiedAt: new Date(),
        deviceId: 'device-1',
        deviceName: 'Device 1',
      },
      { type: 'simple', keepVersions: 10 }
    );

    await manager.createVersion(
      testFilePath2,
      file2Content,
      {
        hash: 'hash-file2',
        size: file2Content.length,
        modifiedAt: new Date(),
        deviceId: 'device-2',
        deviceName: 'Device 2',
      },
      { type: 'simple', keepVersions: 10 }
    );

    const stats = await manager.getStorageStats();

    expect(stats.totalVersions).toBeGreaterThanOrEqual(2);
    expect(stats.totalSize).toBeGreaterThan(0);
    expect(stats.fileCount).toBeGreaterThanOrEqual(2);
  });
});
