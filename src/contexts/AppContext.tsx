import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
  useCallback,
} from 'react';
import { DeviceInfo, FolderConfig } from '../shared/types/sync';
import { AppConfig } from '../shared/types/config';
import { useNotification } from './NotificationContext';

interface AppContextType {
  isInitialized: boolean;
  isOnboardingComplete: boolean;
  config: AppConfig | null;
  folders: FolderConfig[];
  devices: DeviceInfo[];
  currentDevice: DeviceInfo | null;
  refreshConfig: () => Promise<void>;
  refreshFolders: () => Promise<void>;
  refreshDevices: () => Promise<void>;
  addFolder: (folder: Partial<FolderConfig>) => Promise<FolderConfig | null>;
  removeFolder: (folderId: string) => Promise<void>;
  setOnboardingComplete: (complete: boolean) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }
  return context;
}

interface AppProviderProps {
  children: ReactNode;
}

export function AppProvider({ children }: AppProviderProps) {
  const { showError } = useNotification();
  const [isInitialized, setIsInitialized] = useState(false);
  const [isOnboardingComplete, setIsOnboardingComplete] = useState(false);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [folders, setFolders] = useState<FolderConfig[]>([]);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [currentDevice, setCurrentDevice] = useState<DeviceInfo | null>(null);

  const refreshConfig = useCallback(async () => {
    try {
      const newConfig = await window.electronAPI.getConfig();
      setConfig(newConfig);
      setIsOnboardingComplete(newConfig.onboardingState?.completed || false);
    } catch (error) {
      showError(error as Error);
    }
  }, [showError]);

  const refreshFolders = useCallback(async () => {
    try {
      const newFolders = await window.electronAPI.getFolders();
      setFolders(newFolders);
    } catch (error) {
      showError(error as Error);
    }
  }, [showError]);

  const addFolder = useCallback(
    async (folder: Partial<FolderConfig>) => {
      try {
        const created = await window.electronAPI.addFolder(folder as FolderConfig);
        await refreshFolders();
        return created;
      } catch (error) {
        showError(error as Error);
        throw error;
      }
    },
    [refreshFolders, showError]
  );

  const removeFolder = useCallback(
    async (folderId: string) => {
      try {
        await window.electronAPI.removeFolder(folderId);
        await refreshFolders();
      } catch (error) {
        showError(error as Error);
        throw error;
      }
    },
    [refreshFolders, showError]
  );

  const refreshDevices = useCallback(async () => {
    try {
      const newDevices = await window.electronAPI.getDevices();
      setDevices(newDevices);

      // Find current device
      const deviceId = await window.electronAPI.getDeviceId();
      const current = newDevices.find((device: DeviceInfo) => device.id === deviceId);
      if (current) {
        setCurrentDevice(current);
      }
    } catch (error) {
      showError(error as Error);
    }
  }, [showError]);

  const handleSetOnboardingComplete = useCallback(
    (complete: boolean) => {
      setIsOnboardingComplete(complete);
      if (config) {
        window.electronAPI.updateConfig({
          onboardingState: {
            ...config.onboardingState,
            completed: complete,
          },
        } as any);
      }
    },
    [config]
  );

  useEffect(() => {
    const initialize = async () => {
      try {
        await refreshConfig();
        await refreshFolders();
        await refreshDevices();
        setIsInitialized(true);
      } catch (error) {
        showError(error as Error);
        setIsInitialized(true); // Set to true anyway to show error state
      }
    };

    initialize();

    const handleConfigChanged = (): void => {
      void refreshConfig();
    };
    const handleSyncStatusChanged = (): void => {
      void refreshFolders();
    };
    const handleDeviceConnected = (): void => {
      void refreshDevices();
    };
    const handleDeviceDisconnected = (): void => {
      void refreshDevices();
    };

    window.electronAPI.on('config:changed', handleConfigChanged);
    window.electronAPI.on('sync:status-changed', handleSyncStatusChanged);
    window.electronAPI.on('device:connected', handleDeviceConnected);
    window.electronAPI.on('device:disconnected', handleDeviceDisconnected);

    return () => {
      window.electronAPI.off('config:changed', handleConfigChanged);
      window.electronAPI.off('sync:status-changed', handleSyncStatusChanged);
      window.electronAPI.off('device:connected', handleDeviceConnected);
      window.electronAPI.off('device:disconnected', handleDeviceDisconnected);
    };
  }, [refreshConfig, refreshDevices, refreshFolders, showError]);

  const value: AppContextType = {
    isInitialized,
    isOnboardingComplete,
    config,
    folders,
    devices,
    currentDevice,
    refreshConfig,
    refreshFolders,
    refreshDevices,
    addFolder,
    removeFolder,
    setOnboardingComplete: handleSetOnboardingComplete,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
