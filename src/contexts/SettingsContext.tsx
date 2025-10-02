import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
  useCallback,
} from 'react';
import { AppConfig } from '../shared/types/config';
import { rendererLogger } from '../utils/rendererLogger';

interface SettingsContextType {
  config: AppConfig | null;
  theme: 'light' | 'dark' | 'system';
  language: string;
  updateTheme: (theme: 'light' | 'dark' | 'system') => Promise<void>;
  updateLanguage: (language: string) => Promise<void>;
  updateConfig: (config: Partial<AppConfig>) => Promise<void>;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within SettingsProvider');
  }
  return context;
}

interface SettingsProviderProps {
  children: ReactNode;
}

export function SettingsProvider({ children }: SettingsProviderProps) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');
  const [language, setLanguage] = useState('en');

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const appConfig = await window.electronAPI.getConfig();
        setConfig(appConfig);
        setTheme(appConfig.theme);
        setLanguage(appConfig.language);
      } catch (error) {
        rendererLogger.error('Failed to load config', error);
      }
    };

    void loadConfig();

    const handleConfigChanged = (_event: unknown, newConfig: AppConfig): void => {
      setConfig(newConfig);
      setTheme(newConfig.theme);
      setLanguage(newConfig.language);
    };

    window.electronAPI.on('config:changed', handleConfigChanged);

    return () => {
      window.electronAPI.off('config:changed', handleConfigChanged);
    };
  }, []);

  const updateTheme = useCallback(async (newTheme: 'light' | 'dark' | 'system') => {
    try {
      await window.electronAPI.updateConfig({ theme: newTheme });
      setTheme(newTheme);
    } catch (error) {
      rendererLogger.error('Failed to update theme', error);
      throw error;
    }
  }, []);

  const updateLanguage = useCallback(async (newLanguage: string) => {
    try {
      await window.electronAPI.updateConfig({ language: newLanguage as any });
      setLanguage(newLanguage);
    } catch (error) {
      rendererLogger.error('Failed to update language', error);
      throw error;
    }
  }, []);

  const updateConfig = useCallback(async (updates: Partial<AppConfig>) => {
    try {
      const newConfig = await window.electronAPI.updateConfig(updates);
      setConfig(newConfig);
    } catch (error) {
      rendererLogger.error('Failed to update config', error);
      throw error;
    }
  }, []);

  const value: SettingsContextType = {
    config,
    theme,
    language,
    updateTheme,
    updateLanguage,
    updateConfig,
  };

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}
