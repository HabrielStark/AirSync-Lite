import type { ElectronAPI } from '../main/preload';

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

declare module 'micromatch';
declare module 'lodash.debounce';
declare module 'wrtc';

export {};
