import { app, BrowserWindow, dialog, shell, globalShortcut, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import * as path from 'path';
import * as url from 'url';
import Store, { Options as StoreOptions } from 'electron-store';
import fs from 'fs';
import { setupIpcHandlers } from './ipc/handlers';
import { createTray } from './tray/trayManager';
import { initializeLogger } from './utils/logger';
import { FileWatcher } from './sync/fileWatcher';
import { SyncEngine } from './sync/syncEngine';
import { NetworkManager } from './network/networkManager';
import { ScheduleManager } from './schedule/scheduleManager';
import { initializeI18n } from './i18n/i18n';
import { AppConfig } from '../shared/types/config';
import { createCliBridgeServer, CliBridgeServer } from './utils/cliBridge';

// Initialize logger
const logger = initializeLogger();

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

let storeOptions: StoreOptions<AppConfig> = {
  defaults: defaultAppConfig,
};

const configOverride = process.env.AIRSYNC_CONFIG;

if (configOverride) {
  const resolvedPath = path.resolve(configOverride);
  const dir = path.dirname(resolvedPath);
  const name = path.basename(resolvedPath, path.extname(resolvedPath)) || 'config';

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  storeOptions = {
    ...storeOptions,
    cwd: dir,
    name,
  };
}

const store = new Store<AppConfig>(storeOptions);

let mainWindow: BrowserWindow | null = null;
let fileWatcher: FileWatcher | null = null;
let syncEngine: SyncEngine | null = null;
let networkManager: NetworkManager | null = null;
let scheduleManager: ScheduleManager | null = null;
let cliBridge: CliBridgeServer | null = null;

// Add isQuitting property to app
interface AppWithQuitFlag extends Electron.App {
  isQuitting?: boolean;
}

// Enable live reload for Electron in development
if (process.env.NODE_ENV === 'development') {
  // Commented out electron-reload as it's not in dependencies
  // require('electron-reload')(__dirname, {
  //   electron: path.join(__dirname, '..', '..', 'node_modules', '.bin', 'electron'),
  //   hardResetMethod: 'exit'
  // });
}

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Someone tried to run a second instance, focus our window instead.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

async function createWindow(): Promise<void> {
  // Initialize i18n
  await initializeI18n(store.get('language'));

  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 900,
    title: 'AirSync-Lite',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, '../../assets/icons/icon.png'),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false,
  });

  // Load the app
  if (process.env.NODE_ENV === 'development') {
    await mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    await mainWindow.loadURL(
      url.format({
        pathname: path.join(__dirname, '../../build/index.html'),
        protocol: 'file:',
        slashes: true,
      })
    );
  }

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Prevent window from closing to tray
  mainWindow.on('close', (event) => {
    if (!(app as AppWithQuitFlag).isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
}

// Register global shortcuts
function registerGlobalShortcuts(): void {
  const shortcuts = [
    { accelerator: 'CommandOrControl+Alt+S', action: () => mainWindow?.show() },
    { accelerator: 'CommandOrControl+Alt+P', action: () => syncEngine?.togglePauseAll() },
    {
      accelerator: 'CommandOrControl+Alt+L',
      action: () => shell.openPath((logger as any).getLogPath()),
    },
    { accelerator: 'CommandOrControl+Alt+N', action: () => syncEngine?.syncNow() },
  ];

  shortcuts.forEach(({ accelerator, action }) => {
    globalShortcut.register(accelerator, action);
  });
}

// Initialize core services
async function initializeServices(): Promise<void> {
  try {
    // Initialize file watcher
    fileWatcher = new FileWatcher(store);

    // Initialize network manager
    networkManager = new NetworkManager(store);
    await networkManager.start();

    // Initialize sync engine
    syncEngine = new SyncEngine(store, fileWatcher, networkManager);
    await syncEngine.initialize();

    // Initialize schedule manager
    scheduleManager = new ScheduleManager(store, syncEngine);
    scheduleManager.start();

    logger.info('All services initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize services:', error);
    dialog.showErrorBox('Initialization Error', 'Failed to initialize AirSync-Lite services');
    app.quit();
  }
}

// App event handlers
app.whenReady().then(async () => {
  try {
    const syncOnly = process.env.AIRSYNC_SYNC_ONLY === '1';

    if (!syncOnly) {
      await createWindow();
      createTray(mainWindow, store);
      registerGlobalShortcuts();
    }

    setupIpcHandlers(ipcMain, store, syncEngine, networkManager, scheduleManager);
    await initializeServices();

    if (!cliBridge) {
      cliBridge = createCliBridgeServer({
        async sync(folderId?: string) {
          if (!syncEngine) {
            return { success: false, message: 'Sync engine not initialized' };
          }

          await syncEngine.syncNow(folderId);
          return { success: true };
        },
        async statusTree(folderId: string) {
          if (!networkManager) {
            throw new Error('Network manager not initialized');
          }

          const files = await networkManager.getLocalFileList(folderId);
          return { folderId, files };
        },
      });
    }

    if (syncOnly) {
      const folderIdEnv = process.env.AIRSYNC_SYNC_FOLDER || undefined;

      if (process.env.AIRSYNC_ACTION === 'list-folder') {
        const targetFolderId = folderIdEnv ?? '';

        if (!networkManager) {
          throw new Error('Network manager not initialized');
        }

        const files = await networkManager.getLocalFileList(targetFolderId);
        // eslint-disable-next-line no-console
        logger.info('Files listed for folder', { folderId: targetFolderId, files });
        app.exit(0);
        return;
      }

      if (syncEngine) {
        await syncEngine.syncNow(folderIdEnv);
      }
      app.exit(0);
      return;
    }

    // Check for updates
    if (store.get('advanced.autoUpdate')) {
      autoUpdater.checkForUpdatesAndNotify();
    }
  } catch (error) {
    logger.error('Failed to initialize app:', error);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  // On macOS, keep app running in tray
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On macOS, re-create window when dock icon is clicked
  if (mainWindow === null) {
    createWindow();
  } else {
    mainWindow.show();
  }
});

app.on('before-quit', () => {
  (app as AppWithQuitFlag).isQuitting = true;

  // Cleanup
  globalShortcut.unregisterAll();
  fileWatcher?.stop();
  syncEngine?.stop();
  networkManager?.stop();
  scheduleManager?.stop();
  if (cliBridge) {
    cliBridge
      .close()
      .catch((error) => {
        logger.warn('Failed to close CLI bridge cleanly', error);
      })
      .finally(() => {
        cliBridge = null;
      });
  }
});

// Handle certificate errors
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  // In development, ignore certificate errors
  if (process.env.NODE_ENV === 'development') {
    event.preventDefault();
    callback(true);
  } else {
    // In production, use default behavior
    callback(false);
  }
});

// Auto-updater events
autoUpdater.on('update-available', () => {
  logger.info('Update available');
});

autoUpdater.on('update-downloaded', () => {
  logger.info('Update downloaded');

  dialog
    .showMessageBox(mainWindow!, {
      type: 'info',
      title: 'Update Available',
      message:
        'A new version of AirSync-Lite has been downloaded. Restart the application to apply the update.',
      buttons: ['Restart', 'Later'],
    })
    .then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
});

// Export for testing
export { mainWindow, store };
