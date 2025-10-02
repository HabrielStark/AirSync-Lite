import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
  useCallback,
} from 'react';
import { SyncStatus, ConflictInfo, TransferProgress } from '../shared/types/sync';
import { rendererLogger } from '../utils/rendererLogger';

interface SyncContextType {
  syncStatuses: Map<string, SyncStatus>;
  activeTransfers: TransferProgress[];
  conflicts: ConflictInfo[];
  syncNow: (folderId?: string) => Promise<void>;
  pauseSync: (folderId?: string) => Promise<void>;
  resumeSync: (folderId?: string) => Promise<void>;
  resolveConflict: (conflictId: string, resolution: 'local' | 'remote' | 'both') => Promise<void>;
  refreshStatus: () => Promise<void>;
}

const SyncContext = createContext<SyncContextType | undefined>(undefined);

export function useSync() {
  const context = useContext(SyncContext);
  if (!context) {
    throw new Error('useSync must be used within SyncProvider');
  }
  return context;
}

interface SyncProviderProps {
  children: ReactNode;
}

export function SyncProvider({ children }: SyncProviderProps) {
  const [syncStatuses, setSyncStatuses] = useState<Map<string, SyncStatus>>(new Map());
  const [activeTransfers, setActiveTransfers] = useState<TransferProgress[]>([]);
  const [conflicts, setConflicts] = useState<ConflictInfo[]>([]);

  const refreshStatus = useCallback(async () => {
    try {
      const statuses = await window.electronAPI.getSyncStatus();
      const statusMap = new Map<string, SyncStatus>();

      Object.entries(statuses).forEach(([folderId, status]) => {
        statusMap.set(folderId, status as SyncStatus);
      });

      setSyncStatuses(statusMap);

      // Collect all conflicts
      const allConflicts: ConflictInfo[] = [];
      statusMap.forEach((status) => {
        if (status.conflicts) {
          allConflicts.push(...status.conflicts);
        }
      });
      setConflicts(allConflicts);
    } catch (error) {
      rendererLogger.error('Failed to refresh sync status', error);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();

    const handleStatusChanged = (
      _event: unknown,
      data: { folderId: string; status: SyncStatus }
    ): void => {
      setSyncStatuses((prev) => {
        const newMap = new Map(prev);
        newMap.set(data.folderId, data.status);
        return newMap;
      });
    };

    const handleConflictDetected = (_event: unknown, data: { conflict: ConflictInfo }): void => {
      setConflicts((prev) => [...prev, data.conflict]);
    };

    const handleProgress = (_event: unknown, progress: TransferProgress): void => {
      setActiveTransfers((prev) => {
        const index = prev.findIndex((t) => t.fileId === progress.fileId);
        if (index >= 0) {
          const newTransfers = [...prev];
          newTransfers[index] = progress;
          return newTransfers;
        }
        return [...prev, progress];
      });
    };

    const handleTransferComplete = (
      _event: unknown,
      transfer: { progress: TransferProgress }
    ): void => {
      setActiveTransfers((prev) => prev.filter((t) => t.fileId !== transfer.progress.fileId));
    };

    const handleTransferFailed = (
      _event: unknown,
      transfer: { progress: TransferProgress }
    ): void => {
      setActiveTransfers((prev) => prev.filter((t) => t.fileId !== transfer.progress.fileId));
    };

    window.electronAPI.on('sync:status-changed', handleStatusChanged);
    window.electronAPI.on('sync:conflict-detected', handleConflictDetected);
    window.electronAPI.on('sync-progress', handleProgress);
    window.electronAPI.on('transfer-complete', handleTransferComplete);
    window.electronAPI.on('transfer-failed', handleTransferFailed);

    const interval = setInterval(() => {
      void refreshStatus();
    }, 5000);

    return () => {
      clearInterval(interval);
      window.electronAPI.off('sync:status-changed', handleStatusChanged);
      window.electronAPI.off('sync:conflict-detected', handleConflictDetected);
      window.electronAPI.off('sync-progress', handleProgress);
      window.electronAPI.off('transfer-complete', handleTransferComplete);
      window.electronAPI.off('transfer-failed', handleTransferFailed);
    };
  }, [refreshStatus]);

  const syncNow = useCallback(
    async (folderId?: string) => {
      try {
        await window.electronAPI.syncNow(folderId);
        await refreshStatus();
      } catch (error) {
        rendererLogger.error('Failed to start sync', error);
        throw error;
      }
    },
    [refreshStatus]
  );

  const pauseSync = useCallback(
    async (folderId?: string) => {
      try {
        await window.electronAPI.pauseSync(folderId);
        await refreshStatus();
      } catch (error) {
        rendererLogger.error('Failed to pause sync', error);
        throw error;
      }
    },
    [refreshStatus]
  );

  const resumeSync = useCallback(
    async (folderId?: string) => {
      try {
        await window.electronAPI.resumeSync(folderId);
        await refreshStatus();
      } catch (error) {
        rendererLogger.error('Failed to resume sync', error);
        throw error;
      }
    },
    [refreshStatus]
  );

  const resolveConflict = useCallback(
    async (conflictId: string, resolution: 'local' | 'remote' | 'both') => {
      try {
        await window.electronAPI.resolveConflict(conflictId, resolution);
        setConflicts((prev) => prev.filter((c) => c.id !== conflictId));
        await refreshStatus();
      } catch (error) {
        rendererLogger.error('Failed to resolve conflict', error);
        throw error;
      }
    },
    [refreshStatus]
  );

  const value: SyncContextType = {
    syncStatuses,
    activeTransfers,
    conflicts,
    syncNow,
    pauseSync,
    resumeSync,
    resolveConflict,
    refreshStatus,
  };

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}
