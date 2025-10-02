import { BrowserWindow, MenuItemConstructorOptions } from 'electron';
import Store from 'electron-store';
import { AppConfig } from '../../shared/types/config';

interface TrayMenuContext {
  store: Store<AppConfig>;
  mainWindow: BrowserWindow | null;
  onOpenLogs: () => void;
  onCheckUpdates: () => void;
}

export function createTrayMenuTemplate(context: TrayMenuContext): MenuItemConstructorOptions[] {
  const folders = context.store.get('folders');
  const devices = context.store.get('devices');

  return [
    {
      label: 'AirSync-Lite',
      enabled: false,
    },
    { type: 'separator' },
    ...folders.map((folder) => ({
      label: folder.name,
      submenu: [
        {
          label: 'Открыть папку',
          click: () => context.mainWindow?.webContents.send('open-folder', folder.id),
        },
        {
          label: 'Синхронизировать сейчас',
          click: () => context.mainWindow?.webContents.send('sync-folder', folder.id),
        },
      ],
    })),
    { type: 'separator' },
    {
      label: 'Устройства',
      submenu: devices.map((device) => ({
        label: `${device.name} (${device.status})`,
        enabled: false,
      })),
    },
    { type: 'separator' },
    {
      label: 'Настройки',
      click: () => context.mainWindow?.webContents.send('show-settings'),
    },
    {
      label: 'Логи',
      click: context.onOpenLogs,
    },
    {
      label: 'Проверить обновления',
      click: context.onCheckUpdates,
    },
    { type: 'separator' },
    {
      label: 'Выйти',
      role: 'quit',
    },
  ];
}
