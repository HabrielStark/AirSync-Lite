jest.setTimeout(15000);

import { jest } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';

const mockLogsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airsync-tests-logs-'));
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => mockLogsDir),
  },
}));

jest.mock('../../src/main/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { handleCliRequest } from '../../src/main/utils/cliBridge';
import { FileEntry } from '../../src/shared/types/sync';

describe('CLI Bridge', () => {
  afterAll(() => {
    if (fs.existsSync(mockLogsDir)) {
      fs.rmSync(mockLogsDir, { recursive: true, force: true });
    }
  });

  it('handles sync requests via helper', async () => {
    const result = await handleCliRequest(
      { action: 'sync', folderId: 'abc' },
      {
        sync: async (folderId?: string) => ({ success: true, message: folderId ?? 'all' }),
        statusTree: async () => ({ folderId: '', files: [] }),
      }
    );

    expect(result).toEqual({ success: true, message: 'abc' });
  });

  it('handles status-tree requests via helper', async () => {
    const mockFiles: FileEntry[] = [
      {
        name: 'file.txt',
        path: 'file.txt',
        type: 'file',
        size: 8,
        modifiedAt: new Date().toISOString(),
      },
    ];

    const result = await handleCliRequest(
      { action: 'status-tree', folderId: 'folder-1' },
      {
        sync: async () => ({ success: true }),
        statusTree: async (folderId: string) => ({ folderId, files: mockFiles }),
      }
    );

    expect(result).toEqual({ folderId: 'folder-1', files: mockFiles });
  });
});
