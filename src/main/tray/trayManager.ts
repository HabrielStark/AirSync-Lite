import { BrowserWindow, Menu, Tray, nativeTheme, shell } from 'electron';
import * as path from 'path';
import Store from 'electron-store';
import { AppConfig } from '../../shared/types/config';
import { SyncStatus } from '../../shared/types/sync';
import { logger } from '../utils/logger';
import { createTrayMenuTemplate } from './trayTemplate';

let tray: Tray | null = null;
let storeRef: Store<AppConfig> | null = null;

export function createTray(mainWindow: BrowserWindow | null, store: Store<AppConfig>): Tray {
  storeRef = store;
  tray = new Tray(getIconPath('normal'));
  tray.setToolTip('AirSync-Lite');

  updateTrayMenu(mainWindow, store, getIconPath('normal'));

  tray.on('click', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  return tray;
}

export function updateTrayStatus(store: Store<AppConfig>): void {
  if (!tray) return;

  const status = getCurrentStatus(store);
  const iconPath = getIconPath(status);
  tray.setImage(iconPath);
  tray.setToolTip(`AirSync-Lite — ${getStatusText(store)}`);
  updateTrayMenu(null, store, iconPath);
}

function updateTrayMenu(
  mainWindow: BrowserWindow | null,
  store: Store<AppConfig>,
  iconPath: string
): void {
  const template = createTrayMenuTemplate({
    store,
    mainWindow,
    onOpenLogs: () => shell.openPath((logger as any).getLogPath()),
    onCheckUpdates: () => mainWindow?.webContents.send('check-updates'),
  });

  const menu = Menu.buildFromTemplate(template);
  tray?.setContextMenu(menu);
  tray?.setImage(iconPath);
}

function getCurrentStatus(
  store: Store<AppConfig>
): 'normal' | 'syncing' | 'paused' | 'error' | 'offline' {
  const folders = store.get('folders');
  const devices = store.get('devices');

  if (devices.every((d) => d.status !== 'online')) {
    return 'offline';
  }

  const states = folders.map((f) => f.status?.state).filter(Boolean) as SyncStatus['state'][];

  if (states.includes('error')) return 'error';
  if (states.every((state) => state === 'paused')) return 'paused';
  if (states.some((state) => state === 'syncing' || state === 'scanning')) return 'syncing';

  return 'normal';
}

function getStatusText(store: Store<AppConfig>): string {
  const status = getCurrentStatus(store);
  switch (status) {
    case 'syncing':
      return 'Синхронизация…';
    case 'paused':
      return 'Пауза';
    case 'error':
      return 'Ошибка синхронизации';
    case 'offline':
      return 'Нет связи';
    default:
      return 'Готов';
  }
}

function getIconPath(status: 'normal' | 'syncing' | 'paused' | 'error' | 'offline'): string {
  const theme = storeRef?.get('theme') ?? 'system';
  const isDarkMode = theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors);
  const suffix = isDarkMode ? '-dark' : '';
  const fileName = `tray-${status}${suffix}.png`;
  return path.join(__dirname, '..', '..', '..', 'assets', 'icons', fileName);
}
