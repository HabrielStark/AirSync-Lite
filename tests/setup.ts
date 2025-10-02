import * as path from 'path';
import * as os from 'os';

// Mock Electron app
jest.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      const tempDir = path.join(os.tmpdir(), 'airsync-test-' + process.pid);
      return tempDir;
    },
    getAppPath: () => process.cwd(),
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (str: string) => Buffer.from(str),
    decryptString: (buffer: Buffer) => buffer.toString(),
  },
}));

// Suppress console logs during tests
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
