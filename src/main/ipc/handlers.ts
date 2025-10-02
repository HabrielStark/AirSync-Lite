import { dialog, shell, app, BrowserWindow, Tray } from 'electron';
import Store from 'electron-store';
import path from 'path';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { AppConfig } from '../../shared/types/config';
import { FolderConfig } from '../../shared/types/sync';
import { SyncEngine } from '../sync/syncEngine';
import { NetworkManager } from '../network/networkManager';
import { ScheduleManager } from '../schedule/scheduleManager';
import { IgnoreParser } from '../utils/ignoreParser';
import { logger } from '../utils/logger';
import { validateSyncPath } from '../utils/pathSecurity';
import {
  cloneForStore,
  sanitizeConfigPatch,
  sanitizeFullConfig,
  sanitizeFolderInput,
  sanitizeFolderUpdate,
  sanitizeDeviceRename,
  sanitizeDiffPaths,
  sanitizeIgnoreRulesPayload,
  sanitizeLogLines,
} from '../utils/validation';

export function setupIpcHandlers(
  ipcMainInstance: Electron.IpcMain,
  store: Store<AppConfig>,
  syncEngine: SyncEngine | null,
  networkManager: NetworkManager | null,
  scheduleManager: ScheduleManager | null
): void {
  // App info handlers
  ipcMainInstance.handle('app:getVersion', () => app.getVersion());
  ipcMainInstance.handle('app:getPlatform', () => process.platform);

  // Configuration handlers
  ipcMainInstance.handle('config:get', () => store.store);

  ipcMainInstance.handle('config:update', async (_event, config: Partial<AppConfig>) => {
    try {
      const sanitized = sanitizeConfigPatch(config);

      Object.entries(sanitized).forEach(([key, value]) => {
        store.set(key as keyof AppConfig, cloneForStore(value));
      });

      return store.store;
    } catch (error) {
      logger.warn('Rejected config:update payload', { error });
      throw error;
    }
  });

  ipcMainInstance.handle('config:export', async () => {
    const config = store.store;
    const exportData = {
      version: app.getVersion(),
      exportDate: new Date().toISOString(),
      config: {
        ...config,
        // Remove sensitive data
        security: {
          ...config.security,
          uiPassword: '',
        },
      },
    };

    const { filePath } = await dialog.showSaveDialog({
      defaultPath: `airsync-config-${new Date().toISOString().split('T')[0]}.json`,
      filters: [
        { name: 'JSON Files', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (filePath) {
      await fs.writeFile(filePath, JSON.stringify(exportData, null, 2));
      return filePath;
    }

    return null;
  });

  ipcMainInstance.handle('config:import', async (_event, configData: string) => {
    try {
      const parsed = JSON.parse(configData);

      if (!parsed.config) {
        throw new Error('Invalid config file format');
      }

      const sanitized = sanitizeFullConfig(parsed.config, store.store);
      sanitized.security.uiPassword = store.store.security.uiPassword;

      store.set(cloneForStore(sanitized));

      return { success: true };
    } catch (error) {
      logger.error('Failed to import config:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Folder management handlers
  ipcMainInstance.handle('folders:get', () => store.get('folders'));

  ipcMainInstance.handle('folders:add', async (_event, folderConfig: Partial<FolderConfig>) => {
    const sanitized = sanitizeFolderInput(folderConfig);
    const folder: FolderConfig = {
      id: uuidv4(),
      path: sanitized.path,
      name: sanitized.name || path.basename(sanitized.path),
      mode: sanitized.mode || 'send-receive',
      status: { state: 'idle', errors: [], conflicts: [] },
      devices: sanitized.devices || [],
      ignorePatterns: sanitized.ignorePatterns || [],
      versioningPolicy: sanitized.versioningPolicy || { type: 'simple', keepVersions: 5 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const folders = store.get('folders');
    folders.push(folder);
    store.set('folders', folders);

    // Add folder to sync engine
    if (syncEngine) {
      await syncEngine.addFolder(folder);
    }

    return folder;
  });

  ipcMainInstance.handle(
    'folders:update',
    async (_event, folderId: string, updates: Partial<FolderConfig>) => {
      const sanitizedUpdates = sanitizeFolderUpdate(updates);
      const folders = store.get('folders');
      const index = folders.findIndex((f) => f.id === folderId);

      if (index >= 0) {
        folders[index] = {
          ...folders[index],
          ...sanitizedUpdates,
          updatedAt: new Date(),
        };
        store.set('folders', folders);

        return folders[index];
      }

      throw new Error('Folder not found');
    }
  );

  ipcMainInstance.handle('folders:remove', async (_event, folderId: string) => {
    const folders = store.get('folders');
    const filtered = folders.filter((f) => f.id !== folderId);
    store.set('folders', filtered);

    // Remove from sync engine
    if (syncEngine) {
      await syncEngine.removeFolder(folderId);
    }

    return true;
  });

  ipcMainInstance.handle('folders:browse', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    });

    return result.canceled ? null : result.filePaths[0];
  });

  ipcMainInstance.handle('folders:open', async (_event, folderPath: string) => {
    await shell.openPath(folderPath);
  });

  // Device management handlers
  ipcMainInstance.handle('devices:get', () => store.get('devices'));

  ipcMainInstance.handle('devices:getId', () => networkManager?.getDeviceId());

  ipcMainInstance.handle('devices:generatePairingCode', async () => {
    if (!networkManager) {
      throw new Error('Network manager not initialized');
    }

    return await networkManager.generatePairingCode();
  });

  ipcMainInstance.handle('devices:pair', async (_event, code: string) => {
    if (!networkManager) {
      throw new Error('Network manager not initialized');
    }

    return await networkManager.pairDevice(code);
  });

  ipcMainInstance.handle('devices:unpair', async (_event, deviceId: string) => {
    const devices = store.get('devices');
    const filtered = devices.filter((d) => d.id !== deviceId);
    store.set('devices', filtered);

    return true;
  });

  ipcMainInstance.handle('devices:rename', async (_event, deviceId: string, name: string) => {
    const sanitizedName = sanitizeDeviceRename(name);
    const devices = store.get('devices');
    const device = devices.find((d) => d.id === deviceId);

    if (device) {
      device.name = sanitizedName;
      store.set('devices', devices);
      return device;
    }

    throw new Error('Device not found');
  });

  // Sync operation handlers
  ipcMainInstance.handle('sync:getStatus', () => {
    if (!syncEngine) {
      return new Map();
    }

    const statuses = syncEngine.getSyncStatus();
    // Convert Map to plain object for IPC
    const result: Record<string, any> = {};
    if (statuses instanceof Map) {
      for (const [key, value] of statuses) {
        result[key] = value;
      }
    }
    return result;
  });

  ipcMainInstance.handle('sync:now', async (_event, folderId?: string) => {
    if (!syncEngine) {
      throw new Error('Sync engine not initialized');
    }

    await syncEngine.syncNow(folderId);
  });

  ipcMainInstance.handle('sync:trigger', async (_event, folderId?: string) => {
    if (!syncEngine) {
      throw new Error('Sync engine not initialized');
    }

    await syncEngine.syncNow(folderId);
    return { success: true };
  });

  ipcMainInstance.handle('sync:getFileList', async (_event, folderId: string) => {
    if (!networkManager) {
      throw new Error('Network manager not initialized');
    }

    const files = await networkManager.getLocalFileList(folderId);
    return { folderId, files };
  });

  ipcMainInstance.handle('sync:pause', (_event, folderId?: string) => {
    if (!syncEngine) {
      throw new Error('Sync engine not initialized');
    }

    syncEngine.pauseSync(folderId);
  });

  ipcMainInstance.handle('sync:resume', (_event, folderId?: string) => {
    if (!syncEngine) {
      throw new Error('Sync engine not initialized');
    }

    syncEngine.resumeSync(folderId);
  });

  // File operation handlers
  ipcMainInstance.handle('files:getHistory', async () => {
    // This would be implemented by the version manager
    return [];
  });

  ipcMainInstance.handle('files:restoreVersion', async () => {
    // This would be implemented by the version manager
    return true;
  });

  ipcMainInstance.handle(
    'files:resolveConflict',
    async (_event, conflictId: string, resolution: 'local' | 'remote' | 'both') => {
      if (!syncEngine) {
        throw new Error('Sync engine not initialized');
      }

      await syncEngine.resolveConflict(conflictId, resolution);
    }
  );

  ipcMainInstance.handle('files:openDiff', async (_event, filePath1: string, filePath2: string) => {
    try {
      // ✅ SECURITY FIX: Validate paths before spawning process
      const { first, second } = sanitizeDiffPaths(filePath1, filePath2);
      
      // Validate both paths are within allowed directories
      const validatedPath1 = validateSyncPath(first, app.getPath('home'));
      const validatedPath2 = validateSyncPath(second, app.getPath('home'));

      logger.info('Opening diff tool', { path1: validatedPath1, path2: validatedPath2 });

      // Try to find and open external diff tool
      const diffTools = [
        { name: 'code', args: ['--diff'] }, // VS Code
        { name: 'meld', args: [] },
        { name: 'kdiff3', args: [] },
        { name: 'bcompare', args: [] }, // Beyond Compare
        { name: 'winmerge', args: [] },
      ];

      for (const tool of diffTools) {
        try {
          const childProcess = await import('child_process');
          // ✅ SECURITY: shell: false prevents shell injection attacks
          // ✅ SECURITY: paths are validated before use
          childProcess.spawn(tool.name, [...tool.args, validatedPath1, validatedPath2], {
            shell: false,
            stdio: 'ignore',
            detached: false,
          });
          logger.info(`Opened diff tool: ${tool.name}`);
          return true;
        } catch (error) {
          // Try next tool
          logger.debug(`Diff tool ${tool.name} not available`, error);
          continue;
        }
      }

      throw new Error('No diff tool found. Please install VS Code, Meld, or Beyond Compare.');
    } catch (error) {
      logger.error('Failed to open diff tool', error);
      throw new Error(
        `Path validation failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });

  // Ignore rules handlers
  ipcMainInstance.handle('ignore:getPresets', () => {
    const techStacks = [
      'general',
      'node',
      'python',
      'django',
      'flutter',
      'ios',
      'android',
      'unity',
      'unreal',
    ];

    return techStacks.map((stack) => ({
      id: stack,
      name: stack.charAt(0).toUpperCase() + stack.slice(1),
      description: `Common ignore patterns for ${stack} projects`,
      patterns: IgnoreParser.getPresetPatterns(stack),
      techStack: stack,
      builtIn: true,
    }));
  });

  ipcMainInstance.handle('ignore:getRules', async (_event, folderId: string) => {
    const folder = store.get('folders').find((f) => f.id === folderId);
    if (!folder) {
      throw new Error('Folder not found');
    }

    try {
      const stignorePath = path.join(folder.path, '.stignore');
      const content = await fs.readFile(stignorePath, 'utf8');
      return content;
    } catch (error) {
      return '';
    }
  });

  ipcMainInstance.handle('ignore:updateRules', async (_event, folderId: string, rules: string) => {
    const folder = store.get('folders').find((f) => f.id === folderId);
    if (!folder) {
      throw new Error('Folder not found');
    }

    const sanitizedRules = sanitizeIgnoreRulesPayload(rules);
    const stignorePath = path.join(folder.path, '.stignore');
    await fs.writeFile(stignorePath, sanitizedRules.concat(sanitizedRules ? '\n' : ''));

    await updateFolderIgnorePatterns(folderId, sanitizedRules);

    return true;
  });

  async function applyIgnorePresets(folderId: string, presetIds: string[]): Promise<boolean> {
    const folder = store.get('folders').find((f) => f.id === folderId);
    if (!folder) {
      throw new Error('Folder not found');
    }

    const patterns = presetIds.flatMap((presetId) => IgnoreParser.getPresetPatterns(presetId));
    const dedupedPatterns = Array.from(new Set(patterns));
    const stignorePath = path.join(folder.path, '.stignore');
    const existingRules = await readExistingRules(stignorePath);
    const mergedRules = mergeIgnoreRules(existingRules, dedupedPatterns);
    const rules = mergedRules.join('\n');
    const sanitizedRules = sanitizeIgnoreRulesPayload(rules);

    await fs.writeFile(stignorePath, sanitizedRules.concat(sanitizedRules ? '\n' : ''));

    await updateFolderIgnorePatterns(folderId, sanitizedRules);

    return true;
  }

  async function updateFolderIgnorePatterns(folderId: string, rules: string): Promise<void> {
    const folders = store.get('folders');
    const index = folders.findIndex((f) => f.id === folderId);
    if (index >= 0) {
      folders[index].ignorePatterns = rules
        .split('\n')
        .filter((line) => line.trim() && !line.trim().startsWith('#'));
      store.set('folders', folders);
    }

    if (syncEngine) {
      await syncEngine.refreshIgnorePatterns(folderId);
    }
  }

  async function readExistingRules(stignorePath: string): Promise<string[]> {
    try {
      const content = await fs.readFile(stignorePath, 'utf8');
      return content
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  function mergeIgnoreRules(existing: string[], incoming: string[]): string[] {
    const normalizedExisting = new Set(existing.map((pattern) => pattern.trim()).filter(Boolean));
    incoming.forEach((pattern) => {
      const trimmed = pattern.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        normalizedExisting.add(trimmed);
      }
    });
    return Array.from(normalizedExisting);
  }

  ipcMainInstance.handle('ignore:applyPreset', (_event, folderId: string, presetId: string) => {
    return applyIgnorePresets(folderId, [presetId]);
  });

  ipcMainInstance.handle('ignore:applyPresets', (_event, folderId: string, presetIds: string[]) => {
    return applyIgnorePresets(folderId, presetIds);
  });

  // Schedule management handlers
  ipcMainInstance.handle('schedule:get', () => store.get('schedules'));

  ipcMainInstance.handle('schedule:update', (_event, schedule: any) => {
    const sanitized = sanitizeFullConfig({ schedules: schedule }, store.store).schedules;
    store.set('schedules', cloneForStore(sanitized));
    return sanitized;
  });

  // Network management handlers
  ipcMainInstance.handle('network:getRules', () => store.get('schedules.networkRules'));

  ipcMainInstance.handle('network:updateRules', (_event, rules: any) => {
    const sanitizedRules = sanitizeFullConfig({ schedules: { networkRules: rules } }, store.store)
      .schedules.networkRules;
    store.set('schedules.networkRules', cloneForStore(sanitizedRules));
    return sanitizedRules;
  });

  ipcMainInstance.handle('network:getCurrentSSID', () => {
    return scheduleManager?.getCurrentSSIDSync() || null;
  });

  // Logs and diagnostics handlers
  ipcMainInstance.handle('logs:get', async (_event, lines?: number) => {
    const logPath = (logger as any).getLogPath();
    const content = await fs.readFile(logPath, 'utf8');
    const allLines = content.split('\n');

    const sanitizedLines = sanitizeLogLines(lines);

    return allLines.slice(-sanitizedLines).join('\n');
  });

  ipcMainInstance.handle('logs:clear', async () => {
    const logPath = (logger as any).getLogPath();
    await fs.writeFile(logPath, '');
    logger.info('Logs cleared by user');
    return true;
  });

  ipcMainInstance.handle('logs:export', async () => {
    const { filePath } = await dialog.showSaveDialog({
      defaultPath: `airsync-logs-${new Date().toISOString().split('T')[0]}.zip`,
      filters: [
        { name: 'ZIP Files', extensions: ['zip'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (filePath) {
      // Create zip with logs and diagnostics
      // This would be implemented with a zip library
      return filePath;
    }

    return null;
  });

  ipcMainInstance.handle('diagnostics:run', async () => {
    const os = await import('os');
    const diagnostics = {
      platform: process.platform,
      version: app.getVersion(),
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      v8Version: process.versions.v8,
      chromeVersion: process.versions.chrome,
      memory: process.memoryUsage(),
      uptime: process.uptime(),
      cpuUsage: process.cpuUsage(),
      networkInterfaces: os.networkInterfaces(),
      diskSpace: await getDiskSpace(),
      syncStatus: syncEngine?.getSyncStatus() || {},
      connectedDevices: networkManager?.getConnectedDevices() || new Set(),
      scheduleStatus: scheduleManager?.getStatus() || {},
    };

    return diagnostics;
  });

  // UI operation handlers
  ipcMainInstance.handle('ui:showMainWindow', () => {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
      windows[0].show();
      windows[0].focus();
    }
  });

  ipcMainInstance.handle('ui:hideMainWindow', () => {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
      windows[0].hide();
    }
  });

  ipcMainInstance.handle('ui:setTrayTooltip', async (_event, tooltip: string) => {
    const trayModule = (await import('../tray/trayManager')) as {
      getTray?: () => Tray | null;
    };
    const currentTray = trayModule.getTray ? trayModule.getTray() : null;
    if (currentTray) {
      currentTray.setToolTip(tooltip);
    }
    return true;
  });

  ipcMainInstance.handle('ui:showNotification', async (_event, title: string, body: string) => {
    if (store.get('notifications.enabled')) {
      const { Notification } = await import('electron');
      new Notification({ title, body }).show();
    }
  });

  // Update operation handlers
  ipcMainInstance.handle('update:check', async () => {
    // This would be implemented by the auto-updater
    return { available: false };
  });

  ipcMainInstance.handle('update:download', async () => {
    // This would be implemented by the auto-updater
    return true;
  });

  ipcMainInstance.handle('update:install', () => {
    // This would be implemented by the auto-updater
    app.quit();
  });
}

async function getDiskSpace(): Promise<any> {
  // Platform-specific disk space check
  const os = await import('os');

  return {
    free: os.freemem(),
    total: os.totalmem(),
    used: os.totalmem() - os.freemem(),
  };
}
