#!/usr/bin/env node

import { Command } from 'commander';
import Store from 'electron-store';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import net from 'net';
import { getCliBridgePath } from '../shared/constants/cliBridge';
import { AppConfig } from '../shared/types/config';
import { FileEntry } from '../shared/types/sync';
import { logger } from './utils/logger';

const defaultAppConfig: AppConfig = {
  language: 'en',
  theme: 'system',
  folders: [],
  devices: [],
  ignorePresets: [],
  schedules: {
    quietHours: [],
    networkRules: {
      allowedSSIDs: [],
      blockedSSIDs: [],
      lanOnly: false,
      meteringBehavior: 'normal',
      cellularBehavior: 'normal',
    },
  },
  performance: {
    uploadLimit: 0,
    downloadLimit: 0,
    pauseOnLowBattery: true,
    batteryThreshold: 20,
    pauseOnPowerSave: true,
    maxConcurrentTransfers: 3,
    compressionEnabled: true,
    compressionLevel: 6,
    deltaSync: true,
    blockSize: 1024 * 1024,
  },
  security: {
    encryptionEnabled: true,
    encryptionAlgorithm: 'aes-256-gcm',
    uiPasswordEnabled: false,
    uiPassword: '',
    autoLockTimeout: 30,
    deviceVerification: 'first-time',
    certificatePinning: false,
    hidePathsInLogs: false,
  },
  notifications: {
    enabled: true,
    sounds: true,
    soundVolume: 70,
    showOnConflict: true,
    showOnError: true,
    showOnComplete: true,
    showOnDeviceConnect: true,
    showOnDeviceDisconnect: true,
    showProgressBar: true,
    minimumFileSize: 1024 * 1024,
  },
  advanced: {
    gitIgnoreIntegration: true,
    respectGitignore: true,
    symbolicLinks: 'follow',
    filePermissions: 'preserve',
    extendedAttributes: 'preserve',
    caseInsensitive: false,
    telemetryEnabled: false,
    crashReporting: false,
    autoUpdate: true,
    updateChannel: 'stable',
    logLevel: 'info',
    logRetentionDays: 30,
    experimentalFeatures: [],
  },
  onboardingState: undefined,
};

type JsonRecord = Record<string, unknown>;

const program = new Command();

const BRIDGE_TIMEOUT_MS = 3000;

interface BridgeResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

type BridgeRequest =
  | {
      action: 'sync';
      folderId?: string;
    }
  | {
      action: 'status-tree';
      folderId: string;
    };

let pendingBridgeConnection: net.Socket | null = null;

function cleanupPendingConnection(): void {
  if (pendingBridgeConnection) {
    pendingBridgeConnection.destroy();
    pendingBridgeConnection = null;
  }
}

async function sendBridgeRequest<T>(payload: BridgeRequest): Promise<T> {
  const socketPath = getCliBridgePath();

  return await new Promise<T>((resolve, reject) => {
    const client = net.createConnection(socketPath, () => {
      client.write(`${JSON.stringify(payload)}\n`);
    });

    pendingBridgeConnection = client;
    let responseBuffer = '';

    client.setEncoding('utf-8');
    client.setTimeout(BRIDGE_TIMEOUT_MS, () => {
      client.destroy(new Error('CLI bridge request timed out'));
    });

    client.on('data', (chunk) => {
      responseBuffer += chunk;
    });

    client.on('end', () => {
      cleanupPendingConnection();
      try {
        const parsed = JSON.parse(responseBuffer.trim()) as BridgeResponse<T>;
        if (parsed.success && parsed.data !== undefined) {
          resolve(parsed.data);
        } else if (parsed.success) {
          resolve(undefined as unknown as T);
        } else {
          reject(new Error(parsed.error ?? 'Unknown bridge error'));
        }
      } catch (error) {
        reject(error);
      }
    });

    client.on('error', (error) => {
      cleanupPendingConnection();
      reject(error);
    });
  });
}

function isBridgeUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const err = error as NodeJS.ErrnoException;
  return err.code === 'ECONNREFUSED' || err.code === 'ENOENT';
}

function resolveConfigPath(customPath?: string): string {
  if (customPath) {
    return path.resolve(customPath);
  }

  const dataDir = path.join(os.homedir(), '.airsync-lite');
  return path.join(dataDir, 'config.json');
}

async function ensureConfigExists(targetPath: string): Promise<void> {
  const dir = path.dirname(targetPath);
  await fs.mkdir(dir, { recursive: true });
  try {
    await fs.access(targetPath);
  } catch {
    await fs.writeFile(targetPath, JSON.stringify(defaultAppConfig, null, 2));
  }
}

async function loadStore(targetPath: string): Promise<Store<AppConfig>> {
  await ensureConfigExists(targetPath);
  return new Store<AppConfig>({
    cwd: path.dirname(targetPath),
    name: path.basename(targetPath, '.json'),
    defaults: defaultAppConfig,
  });
}

async function runElectron(envOverrides: NodeJS.ProcessEnv = {}): Promise<number> {
  const electronBinary = path.join(
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'electron.cmd' : 'electron'
  );
  const appEntry = path.join('dist', 'main', 'main.js');

  const child = spawn(electronBinary, [appEntry], {
    stdio: 'inherit',
    env: { ...process.env, ...envOverrides },
  });

  return await new Promise<number>((resolve) => {
    child.on('close', (code) => {
      resolve(code ?? 0);
    });
  });
}

async function handleStatus(configPath?: string): Promise<void> {
  const store = await loadStore(resolveConfigPath(configPath));
  const config = store.store;

  const summary = {
    language: config.language,
    theme: config.theme,
    folders: config.folders.length,
    devices: config.devices.length,
    onboardingComplete: config.onboardingState?.completed ?? false,
    autoUpdate: config.advanced.autoUpdate,
  } satisfies JsonRecord;

  // eslint-disable-next-line no-console
  logger.info('Sync summary', summary);
}

async function handleSync(folderId?: string, configPath?: string): Promise<void> {
  const configFile = resolveConfigPath(configPath);
  const store = await loadStore(configFile);
  const folder = folderId ? store.store.folders.find((f) => f.id === folderId) : null;

  if (folderId && !folder) {
    // eslint-disable-next-line no-console
    logger.error(`Folder with id "${folderId}" not found in configuration.`);
    process.exitCode = 1;
    return;
  }

  try {
    const bridgeResponse = await sendBridgeRequest<{ success: boolean; message?: string }>({
      action: 'sync',
      folderId,
    });

    // eslint-disable-next-line no-console
    logger.info('CLI bridge response', bridgeResponse);
    return;
  } catch (error) {
    if (!isBridgeUnavailable(error)) {
      // eslint-disable-next-line no-console
      logger.error('CLI bridge request failed', { error });
      process.exitCode = 1;
      return;
    }
  }

  const exitCode = await runElectron({
    AIRSYNC_SYNC_ONLY: '1',
    AIRSYNC_SYNC_FOLDER: folderId ?? '',
    AIRSYNC_CONFIG: configFile,
  });

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

async function handleConfigExport(target: string, configPath?: string): Promise<void> {
  const store = await loadStore(resolveConfigPath(configPath));
  const exportPath = path.resolve(target);
  await fs.writeFile(exportPath, JSON.stringify(store.store, null, 2));
  // eslint-disable-next-line no-console
  logger.info(`Configuration exported to ${exportPath}`);
}

async function handleConfigImport(source: string, configPath?: string): Promise<void> {
  const sourcePath = path.resolve(source);
  const contents = await fs.readFile(sourcePath, 'utf-8');
  const data = JSON.parse(contents) as AppConfig;

  const store = await loadStore(resolveConfigPath(configPath));
  store.store = {
    ...store.store,
    ...data,
  };
  // eslint-disable-next-line no-console
  logger.info(`Configuration imported from ${sourcePath}`);
}

program.name('airsync').description('AirSync-Lite command line interface').version('1.0.0');

program
  .command('status')
  .description('Print configuration summary')
  .option('-c, --config <path>', 'Path to configuration JSON file')
  .action(async ({ config }) => {
    await handleStatus(config);
  });

program
  .command('start')
  .description('Start the Electron application')
  .action(async () => {
    await runElectron();
  });

program
  .command('sync [folderId]')
  .description('Trigger synchronization (optional specific folder)')
  .option('-c, --config <path>', 'Path to configuration JSON file')
  .action(async (folderId: string | undefined, { config }) => {
    await handleSync(folderId, config);
  });

program
  .command('status-tree <folderId>')
  .description('Print detailed file list for a folder')
  .option('-c, --config <path>', 'Path to configuration JSON file')
  .action(async (folderId: string, { config }) => {
    try {
      const payload = await sendBridgeRequest<{ folderId: string; files: FileEntry[] }>({
        action: 'status-tree',
        folderId,
      });

      // eslint-disable-next-line no-console
      logger.debug('WebSocket payload', payload);
      return;
    } catch (error) {
      if (!isBridgeUnavailable(error)) {
        // eslint-disable-next-line no-console
        logger.error('WebSocket error', { error });
        process.exitCode = 1;
        return;
      }
    }

    const exitCode = await runElectron({
      AIRSYNC_ACTION: 'list-folder',
      AIRSYNC_SYNC_ONLY: '1',
      AIRSYNC_SYNC_FOLDER: folderId,
      AIRSYNC_CONFIG: resolveConfigPath(config),
    });

    if (exitCode !== 0) {
      process.exit(exitCode);
    }
  });

const configCommand = program.command('config').description('Manage configuration');

configCommand
  .command('export <target>')
  .description('Export current configuration to a JSON file')
  .option('-c, --config <path>', 'Path to configuration JSON file')
  .action(async (target: string, { config }) => {
    await handleConfigExport(target, config);
  });

configCommand
  .command('import <source>')
  .description('Import configuration from a JSON file')
  .option('-c, --config <path>', 'Path to configuration JSON file')
  .action(async (source: string, { config }) => {
    await handleConfigImport(source, config);
  });

void program
  .parseAsync(process.argv)
  .catch((error) => {
    // eslint-disable-next-line no-console
    logger.error('CLI command failed', { error });
    process.exit(1);
  })
  .finally(() => {
    cleanupPendingConnection();
  });
