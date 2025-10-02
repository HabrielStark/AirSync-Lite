import { FolderConfig, DeviceInfo } from './sync';

export interface AppConfig {
  language: 'ru' | 'en' | 'es' | 'uk';
  theme: 'light' | 'dark' | 'system';
  folders: FolderConfig[];
  devices: DeviceInfo[];
  ignorePresets: IgnorePreset[];
  schedules: ScheduleConfig;
  performance: PerformanceConfig;
  security: SecurityConfig;
  notifications: NotificationConfig;
  advanced: AdvancedConfig;
  onboardingState?: OnboardingState;
}

export interface IgnorePreset {
  id: string;
  name: string;
  description: string;
  patterns: string[];
  techStack: TechStack;
  builtIn: boolean;
}

export type TechStack =
  | 'node'
  | 'python'
  | 'django'
  | 'flutter'
  | 'ios'
  | 'android'
  | 'unity'
  | 'unreal'
  | 'general';

export interface ScheduleConfig {
  quietHours: QuietHoursRule[];
  networkRules: NetworkRules;
}

export interface QuietHoursRule {
  id: string;
  name: string;
  enabled: boolean;
  startTime: string; // HH:mm format
  endTime: string; // HH:mm format
  daysOfWeek: number[]; // 0-6, where 0 is Sunday
  action: 'pause' | 'limit-speed' | 'disable-notifications';
  speedLimit?: number; // KB/s if action is limit-speed
}

export interface NetworkRules {
  allowedSSIDs: string[];
  blockedSSIDs: string[];
  lanOnly: boolean;
  meteringBehavior: 'pause' | 'limit-speed' | 'normal';
  meteringSpeedLimit?: number; // KB/s
  cellularBehavior: 'pause' | 'limit-speed' | 'normal';
  cellularSpeedLimit?: number; // KB/s
  port?: number;
}

export interface PerformanceConfig {
  uploadLimit: number; // KB/s, 0 = unlimited
  downloadLimit: number; // KB/s, 0 = unlimited
  pauseOnLowBattery: boolean;
  batteryThreshold: number; // percentage
  pauseOnPowerSave: boolean;
  maxConcurrentTransfers: number;
  compressionEnabled: boolean;
  compressionLevel: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  deltaSync: boolean;
  blockSize: number; // bytes
}

export interface SecurityConfig {
  encryptionEnabled: boolean;
  encryptionAlgorithm: 'aes-256-gcm' | 'chacha20-poly1305';
  uiPasswordEnabled: boolean;
  uiPassword: string; // hashed
  autoLockTimeout: number; // minutes, 0 = never
  deviceVerification: 'always' | 'first-time' | 'never';
  certificatePinning: boolean;
  hidePathsInLogs: boolean;
}

export interface NotificationConfig {
  enabled: boolean;
  sounds: boolean;
  soundVolume: number; // 0-100
  showOnConflict: boolean;
  showOnError: boolean;
  showOnComplete: boolean;
  showOnDeviceConnect: boolean;
  showOnDeviceDisconnect: boolean;
  showProgressBar: boolean;
  minimumFileSize: number; // bytes, only show notifications for files larger than this
}

export interface AdvancedConfig {
  gitIgnoreIntegration: boolean;
  respectGitignore: boolean;
  symbolicLinks: 'follow' | 'skip' | 'copy';
  filePermissions: 'preserve' | 'ignore';
  extendedAttributes: 'preserve' | 'ignore';
  caseInsensitive: boolean;
  telemetryEnabled: boolean;
  crashReporting: boolean;
  autoUpdate: boolean;
  updateChannel: 'stable' | 'beta' | 'alpha';
  logLevel: 'error' | 'warn' | 'info' | 'debug';
  logRetentionDays: number;
  experimentalFeatures: string[];
}

export interface GlobalShortcuts {
  showMainWindow: string;
  togglePause: string;
  openLogs: string;
  syncNow: string;
}

export interface UIState {
  sidebarCollapsed: boolean;
  selectedFolderId?: string;
  selectedDeviceId?: string;
  activeTab: string;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  filterBy: string;
  viewMode: 'grid' | 'list';
}

export interface OnboardingState {
  completed: boolean;
  currentStep: number;
  deviceRole?: 'home' | 'school';
  selectedPresets: string[];
  skipTutorial: boolean;
}
