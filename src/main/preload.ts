import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { FolderConfig } from '../shared/types/sync';
import { AppConfig, ScheduleConfig, NetworkRules } from '../shared/types/config';

// Define the API that will be exposed to the renderer process
const electronAPI = {
  // App info
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  getPlatform: () => ipcRenderer.invoke('app:getPlatform'),

  // Configuration
  getConfig: () => ipcRenderer.invoke('config:get'),
  updateConfig: (config: Partial<AppConfig>) => ipcRenderer.invoke('config:update', config),
  exportConfig: () => ipcRenderer.invoke('config:export'),
  importConfig: (configData: string) => ipcRenderer.invoke('config:import', configData),

  // Folder management
  getFolders: () => ipcRenderer.invoke('folders:get'),
  addFolder: (folder: FolderConfig) => ipcRenderer.invoke('folders:add', folder),
  updateFolder: (folderId: string, updates: Partial<FolderConfig>) =>
    ipcRenderer.invoke('folders:update', folderId, updates),
  removeFolder: (folderId: string) => ipcRenderer.invoke('folders:remove', folderId),
  browseFolder: () => ipcRenderer.invoke('folders:browse'),
  openFolder: (path: string) => ipcRenderer.invoke('folders:open', path),

  // Device management
  getDevices: () => ipcRenderer.invoke('devices:get'),
  getDeviceId: () => ipcRenderer.invoke('devices:getId'),
  generatePairingCode: () => ipcRenderer.invoke('devices:generatePairingCode'),
  pairDevice: (code: string) => ipcRenderer.invoke('devices:pair', code),
  unpairDevice: (deviceId: string) => ipcRenderer.invoke('devices:unpair', deviceId),
  renameDevice: (deviceId: string, name: string) =>
    ipcRenderer.invoke('devices:rename', deviceId, name),

  // Sync operations
  getSyncStatus: () => ipcRenderer.invoke('sync:getStatus'),
  syncNow: (folderId?: string) => ipcRenderer.invoke('sync:now', folderId),
  syncTrigger: (folderId?: string) => ipcRenderer.invoke('sync:trigger', folderId),
  getFileList: (folderId: string) => ipcRenderer.invoke('sync:getFileList', folderId),
  pauseSync: (folderId?: string) => ipcRenderer.invoke('sync:pause', folderId),
  resumeSync: (folderId?: string) => ipcRenderer.invoke('sync:resume', folderId),

  // File operations
  getFileHistory: (filePath: string) => ipcRenderer.invoke('files:getHistory', filePath),
  restoreFileVersion: (filePath: string, versionId: string) =>
    ipcRenderer.invoke('files:restoreVersion', filePath, versionId),
  resolveConflict: (conflictId: string, resolution: 'local' | 'remote' | 'both') =>
    ipcRenderer.invoke('files:resolveConflict', conflictId, resolution),
  openInDiffTool: (filePath1: string, filePath2: string) =>
    ipcRenderer.invoke('files:openDiff', filePath1, filePath2),

  // Ignore rules
  getIgnorePresets: () => ipcRenderer.invoke('ignore:getPresets'),
  getIgnoreRules: (folderId: string) => ipcRenderer.invoke('ignore:getRules', folderId),
  updateIgnoreRules: (folderId: string, rules: string) =>
    ipcRenderer.invoke('ignore:updateRules', folderId, rules),
  applyIgnorePreset: (folderId: string, presetId: string) =>
    ipcRenderer.invoke('ignore:applyPreset', folderId, presetId),
  applyIgnorePresets: (folderId: string, presetIds: string[]) =>
    ipcRenderer.invoke('ignore:applyPresets', folderId, presetIds),

  // Schedule management
  getSchedules: () => ipcRenderer.invoke('schedule:get'),
  updateSchedule: (schedule: ScheduleConfig) => ipcRenderer.invoke('schedule:update', schedule),

  // Network management
  getNetworkRules: () => ipcRenderer.invoke('network:getRules'),
  updateNetworkRules: (rules: NetworkRules) => ipcRenderer.invoke('network:updateRules', rules),
  getCurrentSSID: () => ipcRenderer.invoke('network:getCurrentSSID'),

  // Logs and diagnostics
  getLogs: (lines?: number) => ipcRenderer.invoke('logs:get', lines),
  clearLogs: () => ipcRenderer.invoke('logs:clear'),
  exportLogs: () => ipcRenderer.invoke('logs:export'),
  runDiagnostics: () => ipcRenderer.invoke('diagnostics:run'),

  // UI operations
  showMainWindow: () => ipcRenderer.invoke('ui:showMainWindow'),
  hideMainWindow: () => ipcRenderer.invoke('ui:hideMainWindow'),
  setTrayTooltip: (tooltip: string) => ipcRenderer.invoke('ui:setTrayTooltip', tooltip),
  showNotification: (title: string, body: string) =>
    ipcRenderer.invoke('ui:showNotification', title, body),

  // Update operations
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),

  // Event listeners
  on: (channel: string, callback: (event: IpcRendererEvent, ...args: any[]) => void) => {
    const validChannels = [
      'sync:status-changed',
      'sync:conflict-detected',
      'sync:progress',
      'sync:error',
      'device:connected',
      'device:disconnected',
      'file:changed',
      'update:available',
      'update:downloaded',
      'config:changed',
      'schedule:triggered',
    ];

    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, callback);
    }
  },

  off: (channel: string, callback: (event: IpcRendererEvent, ...args: any[]) => void) => {
    ipcRenderer.removeListener(channel, callback);
  },

  once: (channel: string, callback: (event: IpcRendererEvent, ...args: any[]) => void) => {
    ipcRenderer.once(channel, callback);
  },
};

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Type definitions for TypeScript
export type ElectronAPI = typeof electronAPI;
