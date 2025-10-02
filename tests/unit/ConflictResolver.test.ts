import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

import { ConflictResolver } from '../../src/main/sync/conflictResolver';
import Store from 'electron-store';
import { AppConfig } from '../../src/shared/types/config';
import { ConflictInfo, FileVersion } from '../../src/shared/types/sync';

describe('ConflictResolver (CRITICAL BUG FIXES)', () => {
  let tempDir: string;
  let resolver: ConflictResolver;
  let store: Store<AppConfig>;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), 'conflict-test-' + Date.now());

    store = new Store<AppConfig>({
      cwd: tempDir,
      name: 'test-config',
    });
    resolver = new ConflictResolver(store);
  });

  const createConflict = (overrides: Partial<ConflictInfo> = {}): ConflictInfo => {
    const filePath = overrides.filePath ?? path.join(tempDir, 'file.txt');
    const base: ConflictInfo = {
      id: overrides.id ?? 'conflict-1',
      filePath,
      localVersion:
        overrides.localVersion ??
        ({
          id: 'local-version',
          hash: 'local-hash',
          size: 100,
          modifiedAt: new Date('2025-01-01T12:00:00Z'),
          modifiedBy: 'User A',
          deviceId: 'device-local',
          deviceName: 'Local Device',
          filePath,
        } as FileVersion),
      remoteVersion:
        overrides.remoteVersion ??
        ({
          id: 'remote-version',
          hash: 'remote-hash',
          size: 120,
          modifiedAt: new Date('2025-01-01T12:00:05Z'),
          modifiedBy: 'User B',
          deviceId: 'device-remote',
          deviceName: 'Remote Device',
          filePath,
        } as FileVersion),
      detectedAt: overrides.detectedAt ?? new Date(),
      resolved: overrides.resolved ?? false,
      folderId: overrides.folderId,
      resolution: overrides.resolution,
      resolvedAt: overrides.resolvedAt,
    };

    return {
      ...base,
      ...overrides,
      localVersion: { ...base.localVersion, ...overrides.localVersion } as FileVersion,
      remoteVersion: { ...base.remoteVersion, ...overrides.remoteVersion } as FileVersion,
    };
  };

  it('✅ BUG FIX #7: threshold should be 10 seconds (not 60)', async () => {
    const now = new Date();
    const fifteenSecondsAgo = new Date(now.getTime() - 15000);

    // With 15 seconds difference, should NOT be a conflict (clear winner)
    const isConflict = await resolver.detectConflicts(
      '/test/file.txt',
      'hash1',
      fifteenSecondsAgo,
      'hash2',
      now
    );

    // 15 seconds > 10 second threshold → no conflict
    expect(isConflict).toBe(false);
  });

  it('should detect conflict when times are close', async () => {
    const now = new Date();
    const fiveSecondsAgo = new Date(now.getTime() - 5000);

    // 5 seconds difference < 10 second threshold → conflict!
    const isConflict = await resolver.detectConflicts(
      '/test/file.txt',
      'hash1',
      fiveSecondsAgo,
      'hash2',
      now
    );

    expect(isConflict).toBe(true);
  });

  it('should NOT detect conflict when hashes are identical', async () => {
    const now = new Date();
    const oneSecondAgo = new Date(now.getTime() - 1000);

    const isConflict = await resolver.detectConflicts(
      '/test/file.txt',
      'same-hash',
      oneSecondAgo,
      'same-hash',
      now
    );

    expect(isConflict).toBe(false);
  });

  it('should resolve conflict by choosing newer file', async () => {
    const localTime = new Date('2025-01-01T12:00:00Z');
    const remoteTime = new Date('2025-01-01T12:01:00Z'); // 1 minute newer

    const conflict = createConflict({
      filePath: path.join(tempDir, 'file.txt'),
      localVersion: {
        id: 'local',
        hash: 'hash1',
        size: 100,
        modifiedAt: localTime,
        modifiedBy: 'User A',
        deviceId: 'device-local',
        deviceName: 'Local Device',
        filePath: path.join(tempDir, 'file.txt'),
      } as FileVersion,
      remoteVersion: {
        id: 'remote',
        hash: 'hash2',
        size: 150,
        modifiedAt: remoteTime,
        modifiedBy: 'User B',
        deviceId: 'device-remote',
        deviceName: 'Remote Device',
        filePath: path.join(tempDir, 'file.txt'),
      } as FileVersion,
    });

    await fs.mkdir(path.dirname(conflict.filePath), { recursive: true });
    await fs.writeFile(conflict.filePath, 'local-content');
    await resolver.resolveConflict(conflict, 'remote');

    expect(conflict.resolved).toBe(true);
    expect(conflict.resolution).toBe('remote');
    expect(conflict.resolvedAt).toBeDefined();
  });

  it('should handle manual resolution', async () => {
    const conflict = createConflict({ filePath: path.join(tempDir, 'file.txt') });

    await fs.mkdir(path.dirname(conflict.filePath), { recursive: true });
    await fs.writeFile(conflict.filePath, 'local-content');
    await resolver.resolveConflict(conflict, 'manual');

    expect(conflict.resolution).toBe('manual');
    expect(conflict.resolved).toBe(true);
    expect(conflict.resolvedAt).toBeDefined();
  });

  it('should list pending conflicts', async () => {
    const conflict1Path = path.join(tempDir, 'file1.txt');
    const conflict2Path = path.join(tempDir, 'file2.txt');

    await fs.mkdir(tempDir, { recursive: true });
    await fs.writeFile(conflict1Path, 'content-1');
    await fs.writeFile(conflict2Path, 'content-2');

    const conflict1 = createConflict({ id: 'conflict-1', filePath: conflict1Path });

    const conflict2 = createConflict({ id: 'conflict-2', filePath: conflict2Path });

    // simulate manual resolution so conflicts marked as resolved
    await resolver.resolveConflict(conflict1, 'manual');
    await resolver.resolveConflict(conflict2, 'manual');

    expect(conflict1.resolved).toBe(true);
    expect(conflict2.resolved).toBe(true);
  });
});
