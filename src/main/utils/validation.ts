import {
  AppConfig,
  AdvancedConfig,
  IgnorePreset,
  NotificationConfig,
  OnboardingState,
  PerformanceConfig,
  ScheduleConfig,
  SecurityConfig,
} from '../../shared/types/config';
import { ConflictInfo, DeviceInfo, FolderConfig } from '../../shared/types/sync';

type PlainObject = Record<string, unknown>;

const ALLOWED_LANGUAGES = new Set<AppConfig['language']>(['ru', 'en', 'es', 'uk']);
const ALLOWED_THEMES = new Set<AppConfig['theme']>(['light', 'dark', 'system']);
const ALLOWED_FOLDER_MODES = new Set<FolderConfig['mode']>(['send-receive', 'receive-only']);

const ISO_TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

const MAX_LOG_LINES = 5000;
const DEFAULT_LOG_LINES = 1000;
const MAX_IGNORE_RULE_LENGTH = 20000;
const MIN_PAIRING_CODE_LENGTH = 16;

function isPlainObject(value: unknown): value is PlainObject {
  return (
    typeof value === 'object' && value !== null && (value as PlainObject).constructor === Object
  );
}

function ensureString(
  value: unknown,
  field: string,
  options?: { allowEmpty?: boolean; maxLength?: number; pattern?: RegExp; enum?: Set<string> }
): string {
  if (typeof value !== 'string') {
    throw new Error(`Field "${field}" must be a string.`);
  }
  const trimmed = value.trim();
  if (!options?.allowEmpty && trimmed.length === 0) {
    throw new Error(`Field "${field}" cannot be empty.`);
  }
  if (options?.maxLength && trimmed.length > options.maxLength) {
    throw new Error(`Field "${field}" exceeds maximum length of ${options.maxLength}`);
  }
  if (options?.pattern && !options.pattern.test(trimmed)) {
    throw new Error(`Field "${field}" has invalid format.`);
  }
  if (options?.enum && !options.enum.has(trimmed)) {
    throw new Error(`Field "${field}" must be one of: ${Array.from(options.enum).join(', ')}`);
  }
  return trimmed;
}

function ensureBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Field "${field}" must be a boolean.`);
  }
  return value;
}

function ensureNumber(
  value: unknown,
  field: string,
  options?: { min?: number; max?: number; integer?: boolean }
): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`Field "${field}" must be a number.`);
  }
  if (options?.integer && !Number.isInteger(value)) {
    throw new Error(`Field "${field}" must be an integer.`);
  }
  if (options?.min !== undefined && value < options.min) {
    throw new Error(`Field "${field}" must be >= ${options.min}.`);
  }
  if (options?.max !== undefined && value > options.max) {
    throw new Error(`Field "${field}" must be <= ${options.max}.`);
  }
  return value;
}

function ensureStringArray(
  value: unknown,
  field: string,
  options?: { allowEmpty?: boolean; maxLength?: number; maxEntries?: number }
): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Field "${field}" must be an array.`);
  }
  if (options?.maxEntries && value.length > options.maxEntries) {
    throw new Error(`Field "${field}" exceeds maximum length of ${options.maxEntries}.`);
  }
  return value.map((entry, index) =>
    ensureString(entry, `${field}[${index}]`, {
      allowEmpty: options?.allowEmpty,
      maxLength: options?.maxLength,
    })
  );
}

function sanitizeIgnorePreset(value: unknown): IgnorePreset {
  if (!isPlainObject(value)) {
    throw new Error('Ignore preset must be an object.');
  }
  return {
    id: ensureString(value.id, 'ignorePresets[].id'),
    name: ensureString(value.name, 'ignorePresets[].name'),
    description: ensureString(value.description, 'ignorePresets[].description', {
      allowEmpty: true,
      maxLength: 512,
    }),
    patterns: ensureStringArray(value.patterns, 'ignorePresets[].patterns', {
      allowEmpty: true,
      maxEntries: 200,
      maxLength: 256,
    }),
    techStack: ensureString(value.techStack, 'ignorePresets[].techStack') as IgnorePreset['techStack'],
    builtIn: ensureBoolean(value.builtIn, 'ignorePresets[].builtIn'),
  };
}

function sanitizeQuietHours(value: unknown, field: string): ScheduleConfig['quietHours'] {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array.`);
  }
  return value.map((rule, index) => {
    if (!isPlainObject(rule)) {
      throw new Error(`${field}[${index}] must be an object.`);
    }
    return {
      id: ensureString(rule.id, `${field}[${index}].id`),
      name: ensureString(rule.name, `${field}[${index}].name`),
      enabled: ensureBoolean(rule.enabled, `${field}[${index}].enabled`),
      startTime: ensureString(rule.startTime, `${field}[${index}].startTime`, {
        pattern: ISO_TIME_REGEX,
      }),
      endTime: ensureString(rule.endTime, `${field}[${index}].endTime`, {
        pattern: ISO_TIME_REGEX,
      }),
      daysOfWeek: sanitizeNumberArray(rule.daysOfWeek, `${field}[${index}].daysOfWeek`, {
        min: 0,
        max: 6,
        integer: true,
        maxEntries: 7,
      }),
      action: ensureString(rule.action, `${field}[${index}].action`, {
        enum: new Set(['pause', 'limit-speed', 'disable-notifications']),
      }) as 'pause' | 'limit-speed' | 'disable-notifications',
      speedLimit:
        rule.speedLimit === undefined
          ? undefined
          : ensureNumber(rule.speedLimit, `${field}[${index}].speedLimit`, {
              min: 0,
              integer: true,
            }),
    };
  });
}

function sanitizeNumberArray(
  value: unknown,
  field: string,
  options?: { min?: number; max?: number; integer?: boolean; maxEntries?: number }
): number[] {
  if (!Array.isArray(value)) {
    throw new Error(`Field "${field}" must be an array.`);
  }
  if (options?.maxEntries && value.length > options.maxEntries) {
    throw new Error(`Field "${field}" exceeds maximum length of ${options.maxEntries}.`);
  }
  return value.map((entry, index) => ensureNumber(entry, `${field}[${index}]`, options));
}

function sanitizeNetworkRules(value: unknown): ScheduleConfig['networkRules'] {
  if (!isPlainObject(value)) {
    throw new Error('networkRules must be an object.');
  }
  return {
    allowedSSIDs: ensureStringArray(value.allowedSSIDs ?? [], 'networkRules.allowedSSIDs', {
      allowEmpty: true,
      maxEntries: 128,
      maxLength: 64,
    }),
    blockedSSIDs: ensureStringArray(value.blockedSSIDs ?? [], 'networkRules.blockedSSIDs', {
      allowEmpty: true,
      maxEntries: 128,
      maxLength: 64,
    }),
    lanOnly: ensureBoolean(value.lanOnly ?? false, 'networkRules.lanOnly'),
    meteringBehavior: ensureString(
      value.meteringBehavior ?? 'normal',
      'networkRules.meteringBehavior',
      {
        enum: new Set(['pause', 'limit-speed', 'normal']),
      }
    ) as ScheduleConfig['networkRules']['meteringBehavior'],
    meteringSpeedLimit:
      value.meteringSpeedLimit === undefined
        ? undefined
        : ensureNumber(value.meteringSpeedLimit, 'networkRules.meteringSpeedLimit', {
            min: 0,
            integer: true,
          }),
    cellularBehavior: ensureString(
      value.cellularBehavior ?? 'normal',
      'networkRules.cellularBehavior',
      {
        enum: new Set(['pause', 'limit-speed', 'normal']),
      }
    ) as ScheduleConfig['networkRules']['cellularBehavior'],
    cellularSpeedLimit:
      value.cellularSpeedLimit === undefined
        ? undefined
        : ensureNumber(value.cellularSpeedLimit, 'networkRules.cellularSpeedLimit', {
            min: 0,
            integer: true,
          }),
    port:
      value.port === undefined
        ? undefined
        : ensureNumber(value.port, 'networkRules.port', { min: 1024, max: 65535, integer: true }),
  };
}

function sanitizeScheduleConfig(value: unknown): ScheduleConfig {
  if (!isPlainObject(value)) {
    throw new Error('schedules must be an object.');
  }
  return {
    quietHours: sanitizeQuietHours(value.quietHours ?? [], 'schedules.quietHours'),
    networkRules: sanitizeNetworkRules(value.networkRules ?? {}),
  };
}

function sanitizePerformanceConfig(value: unknown): PerformanceConfig {
  if (!isPlainObject(value)) {
    throw new Error('performance must be an object.');
  }
  return {
    uploadLimit: ensureNumber(value.uploadLimit ?? 0, 'performance.uploadLimit', {
      min: 0,
      integer: true,
    }),
    downloadLimit: ensureNumber(value.downloadLimit ?? 0, 'performance.downloadLimit', {
      min: 0,
      integer: true,
    }),
    pauseOnLowBattery: ensureBoolean(
      value.pauseOnLowBattery ?? true,
      'performance.pauseOnLowBattery'
    ),
    batteryThreshold: ensureNumber(value.batteryThreshold ?? 20, 'performance.batteryThreshold', {
      min: 0,
      max: 100,
      integer: true,
    }),
    pauseOnPowerSave: ensureBoolean(value.pauseOnPowerSave ?? true, 'performance.pauseOnPowerSave'),
    maxConcurrentTransfers: ensureNumber(
      value.maxConcurrentTransfers ?? 3,
      'performance.maxConcurrentTransfers',
      { min: 1, max: 8, integer: true }
    ),
    compressionEnabled: ensureBoolean(
      value.compressionEnabled ?? true,
      'performance.compressionEnabled'
    ),
    compressionLevel: ensureNumber(value.compressionLevel ?? 6, 'performance.compressionLevel', {
      min: 1,
      max: 9,
      integer: true,
    }) as PerformanceConfig['compressionLevel'],
    deltaSync: ensureBoolean(value.deltaSync ?? true, 'performance.deltaSync'),
    blockSize: ensureNumber(value.blockSize ?? 1024 * 1024, 'performance.blockSize', {
      min: 4096,
      max: 32 * 1024 * 1024,
      integer: true,
    }),
  };
}

function sanitizeSecurityConfig(value: unknown): SecurityConfig {
  if (!isPlainObject(value)) {
    throw new Error('security must be an object.');
  }
  return {
    encryptionEnabled: ensureBoolean(value.encryptionEnabled ?? true, 'security.encryptionEnabled'),
    encryptionAlgorithm: ensureString(
      value.encryptionAlgorithm ?? 'aes-256-gcm',
      'security.encryptionAlgorithm',
      {
        enum: new Set(['aes-256-gcm', 'chacha20-poly1305']),
      }
    ) as SecurityConfig['encryptionAlgorithm'],
    uiPasswordEnabled: ensureBoolean(
      value.uiPasswordEnabled ?? false,
      'security.uiPasswordEnabled'
    ),
    uiPassword: ensureString(value.uiPassword ?? '', 'security.uiPassword', {
      allowEmpty: true,
      maxLength: 256,
    }),
    autoLockTimeout: ensureNumber(value.autoLockTimeout ?? 30, 'security.autoLockTimeout', {
      min: 0,
      max: 1440,
      integer: true,
    }),
    deviceVerification: ensureString(
      value.deviceVerification ?? 'first-time',
      'security.deviceVerification',
      {
        enum: new Set(['always', 'first-time', 'never']),
      }
    ) as SecurityConfig['deviceVerification'],
    certificatePinning: ensureBoolean(
      value.certificatePinning ?? false,
      'security.certificatePinning'
    ),
    hidePathsInLogs: ensureBoolean(value.hidePathsInLogs ?? false, 'security.hidePathsInLogs'),
  };
}

function sanitizeNotificationConfig(value: unknown): NotificationConfig {
  if (!isPlainObject(value)) {
    throw new Error('notifications must be an object.');
  }
  return {
    enabled: ensureBoolean(value.enabled ?? true, 'notifications.enabled'),
    sounds: ensureBoolean(value.sounds ?? true, 'notifications.sounds'),
    soundVolume: ensureNumber(value.soundVolume ?? 70, 'notifications.soundVolume', {
      min: 0,
      max: 100,
      integer: true,
    }),
    showOnConflict: ensureBoolean(value.showOnConflict ?? true, 'notifications.showOnConflict'),
    showOnError: ensureBoolean(value.showOnError ?? true, 'notifications.showOnError'),
    showOnComplete: ensureBoolean(value.showOnComplete ?? true, 'notifications.showOnComplete'),
    showOnDeviceConnect: ensureBoolean(
      value.showOnDeviceConnect ?? true,
      'notifications.showOnDeviceConnect'
    ),
    showOnDeviceDisconnect: ensureBoolean(
      value.showOnDeviceDisconnect ?? true,
      'notifications.showOnDeviceDisconnect'
    ),
    showProgressBar: ensureBoolean(value.showProgressBar ?? true, 'notifications.showProgressBar'),
    minimumFileSize: ensureNumber(
      value.minimumFileSize ?? 1024 * 1024,
      'notifications.minimumFileSize',
      { min: 0, integer: true }
    ),
  };
}

function sanitizeAdvancedConfig(value: unknown): AdvancedConfig {
  if (!isPlainObject(value)) {
    throw new Error('advanced must be an object.');
  }
  return {
    gitIgnoreIntegration: ensureBoolean(
      value.gitIgnoreIntegration ?? true,
      'advanced.gitIgnoreIntegration'
    ),
    respectGitignore: ensureBoolean(value.respectGitignore ?? true, 'advanced.respectGitignore'),
    symbolicLinks: ensureString(value.symbolicLinks ?? 'follow', 'advanced.symbolicLinks', {
      enum: new Set(['follow', 'skip', 'copy']),
    }) as AdvancedConfig['symbolicLinks'],
    filePermissions: ensureString(value.filePermissions ?? 'preserve', 'advanced.filePermissions', {
      enum: new Set(['preserve', 'ignore']),
    }) as AdvancedConfig['filePermissions'],
    extendedAttributes: ensureString(
      value.extendedAttributes ?? 'preserve',
      'advanced.extendedAttributes',
      {
        enum: new Set(['preserve', 'ignore']),
      }
    ) as AdvancedConfig['extendedAttributes'],
    caseInsensitive: ensureBoolean(value.caseInsensitive ?? false, 'advanced.caseInsensitive'),
    telemetryEnabled: ensureBoolean(value.telemetryEnabled ?? false, 'advanced.telemetryEnabled'),
    crashReporting: ensureBoolean(value.crashReporting ?? false, 'advanced.crashReporting'),
    autoUpdate: ensureBoolean(value.autoUpdate ?? true, 'advanced.autoUpdate'),
    updateChannel: ensureString(value.updateChannel ?? 'stable', 'advanced.updateChannel', {
      enum: new Set(['stable', 'beta', 'alpha']),
    }) as AdvancedConfig['updateChannel'],
    logLevel: ensureString(value.logLevel ?? 'info', 'advanced.logLevel', {
      enum: new Set(['error', 'warn', 'info', 'debug']),
    }) as AdvancedConfig['logLevel'],
    logRetentionDays: ensureNumber(value.logRetentionDays ?? 30, 'advanced.logRetentionDays', {
      min: 1,
      max: 365,
      integer: true,
    }),
    experimentalFeatures: ensureStringArray(
      value.experimentalFeatures ?? [],
      'advanced.experimentalFeatures',
      { allowEmpty: true, maxEntries: 32, maxLength: 64 }
    ),
  };
}

function sanitizeOnboardingState(value: unknown): OnboardingState {
  if (!isPlainObject(value)) {
    throw new Error('onboardingState must be an object.');
  }
  return {
    completed: ensureBoolean(value.completed ?? false, 'onboardingState.completed'),
    currentStep: ensureNumber(value.currentStep ?? 0, 'onboardingState.currentStep', {
      min: 0,
      integer: true,
    }),
    deviceRole:
      value.deviceRole === undefined
        ? undefined
        : (ensureString(value.deviceRole, 'onboardingState.deviceRole') as 'home' | 'school'),
    selectedPresets: ensureStringArray(
      value.selectedPresets ?? [],
      'onboardingState.selectedPresets',
      { allowEmpty: true, maxEntries: 32, maxLength: 64 }
    ),
    skipTutorial: ensureBoolean(value.skipTutorial ?? false, 'onboardingState.skipTutorial'),
  };
}

function sanitizeDate(input: unknown, field: string): Date {
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) {
      throw new Error(`Field "${field}" has invalid date.`);
    }
    return input;
  }
  if (typeof input === 'string' || typeof input === 'number') {
    const parsed = new Date(input);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`Field "${field}" has invalid date.`);
    }
    return parsed;
  }
  throw new Error(`Field "${field}" must be a valid date.`);
}

function sanitizeFolderConfig(value: unknown, indexLabel: string): FolderConfig {
  if (!isPlainObject(value)) {
    throw new Error(`${indexLabel} must be an object.`);
  }
  return {
    id: ensureString(value.id, `${indexLabel}.id`),
    path: ensureString(value.path, `${indexLabel}.path`, { maxLength: 4096 }),
    name: ensureString(value.name, `${indexLabel}.name`, { maxLength: 256 }),
    mode: ensureString(value.mode ?? 'send-receive', `${indexLabel}.mode`, {
      enum: ALLOWED_FOLDER_MODES,
    }) as FolderConfig['mode'],
    status: sanitizeSyncStatus(
      value.status ?? { state: 'idle', errors: [], conflicts: [] },
      `${indexLabel}.status`
    ),
    devices: ensureStringArray(value.devices ?? [], `${indexLabel}.devices`, {
      allowEmpty: true,
      maxEntries: 128,
      maxLength: 64,
    }),
    ignorePatterns: ensureStringArray(value.ignorePatterns ?? [], `${indexLabel}.ignorePatterns`, {
      allowEmpty: true,
      maxEntries: 512,
      maxLength: 256,
    }),
    versioningPolicy: sanitizeVersioningPolicy(
      value.versioningPolicy ?? { type: 'simple', keepVersions: 5 },
      `${indexLabel}.versioningPolicy`
    ),
    createdAt: sanitizeDate(value.createdAt ?? new Date(), `${indexLabel}.createdAt`),
    updatedAt: sanitizeDate(value.updatedAt ?? new Date(), `${indexLabel}.updatedAt`),
    lastSyncAt: value.lastSyncAt
      ? sanitizeDate(value.lastSyncAt, `${indexLabel}.lastSyncAt`)
      : undefined,
    stats: value.stats ? sanitizeFolderStats(value.stats, `${indexLabel}.stats`) : undefined,
  };
}

function sanitizeFolderStats(value: unknown, field: string): FolderConfig['stats'] {
  if (!isPlainObject(value)) {
    throw new Error(`${field} must be an object.`);
  }
  return {
    totalFiles: ensureNumber(value.totalFiles ?? 0, `${field}.totalFiles`, {
      min: 0,
      integer: true,
    }),
    totalDirectories: ensureNumber(value.totalDirectories ?? 0, `${field}.totalDirectories`, {
      min: 0,
      integer: true,
    }),
    totalSize: ensureNumber(value.totalSize ?? 0, `${field}.totalSize`, { min: 0, integer: true }),
    ignoredFiles: ensureNumber(value.ignoredFiles ?? 0, `${field}.ignoredFiles`, {
      min: 0,
      integer: true,
    }),
    lastScanAt: value.lastScanAt
      ? sanitizeDate(value.lastScanAt, `${field}.lastScanAt`)
      : undefined,
    scanDuration:
      value.scanDuration === undefined
        ? undefined
        : ensureNumber(value.scanDuration, `${field}.scanDuration`, { min: 0 }),
  };
}

function sanitizeSyncStatus(value: unknown, field: string): FolderConfig['status'] {
  if (!isPlainObject(value)) {
    throw new Error(`${field} must be an object.`);
  }
  const state = ensureString(value.state ?? 'idle', `${field}.state`, {
    enum: new Set(['idle', 'scanning', 'syncing', 'paused', 'error', 'conflict']),
  }) as FolderConfig['status']['state'];
  return {
    state,
    progress:
      value.progress === undefined
        ? undefined
        : ensureNumber(value.progress, `${field}.progress`, { min: 0, max: 100 }),
    currentFile:
      value.currentFile === undefined
        ? undefined
        : ensureString(value.currentFile, `${field}.currentFile`, { allowEmpty: true }),
    totalFiles:
      value.totalFiles === undefined
        ? undefined
        : ensureNumber(value.totalFiles, `${field}.totalFiles`, { min: 0, integer: true }),
    completedFiles:
      value.completedFiles === undefined
        ? undefined
        : ensureNumber(value.completedFiles, `${field}.completedFiles`, { min: 0, integer: true }),
    bytesTransferred:
      value.bytesTransferred === undefined
        ? undefined
        : ensureNumber(value.bytesTransferred, `${field}.bytesTransferred`, {
            min: 0,
            integer: true,
          }),
    totalBytes:
      value.totalBytes === undefined
        ? undefined
        : ensureNumber(value.totalBytes, `${field}.totalBytes`, { min: 0, integer: true }),
    errors: Array.isArray(value.errors)
      ? value.errors.map((error, index) => {
          if (!isPlainObject(error)) {
            throw new Error(`${field}.errors[${index}] must be an object.`);
          }
          return {
            id: ensureString(error.id, `${field}.errors[${index}].id`),
            type: ensureString(error.type ?? 'unknown', `${field}.errors[${index}].type`, {
              enum: new Set(['permission', 'network', 'disk', 'conflict', 'unknown']),
            }) as 'permission' | 'network' | 'disk' | 'conflict' | 'unknown',
            message: ensureString(error.message, `${field}.errors[${index}].message`),
            filePath:
              error.filePath === undefined
                ? undefined
                : ensureString(error.filePath, `${field}.errors[${index}].filePath`),
            timestamp: sanitizeDate(
              error.timestamp ?? new Date(),
              `${field}.errors[${index}].timestamp`
            ),
            retryable: ensureBoolean(
              error.retryable ?? true,
              `${field}.errors[${index}].retryable`
            ),
            retryCount: ensureNumber(
              error.retryCount ?? 0,
              `${field}.errors[${index}].retryCount`,
              { min: 0, integer: true }
            ),
          };
        })
      : [],
    conflicts: Array.isArray(value.conflicts)
      ? value.conflicts.map((conflict, index) =>
          sanitizeConflictInfo(conflict, `${field}.conflicts[${index}]`)
        )
      : [],
    events: Array.isArray(value.events) ? [] : undefined,
  };
}

function sanitizeConflictInfo(value: unknown, field: string): ConflictInfo {
  if (!isPlainObject(value)) {
    throw new Error(`${field} must be an object.`);
  }
  return {
    id: ensureString(value.id, `${field}.id`),
    filePath: ensureString(value.filePath, `${field}.filePath`),
    folderId:
      value.folderId === undefined ? undefined : ensureString(value.folderId, `${field}.folderId`),
    localVersion: sanitizeFileVersion(value.localVersion, `${field}.localVersion`),
    remoteVersion: sanitizeFileVersion(value.remoteVersion, `${field}.remoteVersion`),
    detectedAt: sanitizeDate(value.detectedAt ?? new Date(), `${field}.detectedAt`),
    resolved: ensureBoolean(value.resolved ?? false, `${field}.resolved`),
    resolution:
      value.resolution === undefined
        ? undefined
        : (ensureString(value.resolution, `${field}.resolution`, {
            enum: new Set(['local', 'remote', 'both', 'manual']),
          }) as ConflictInfo['resolution']),
    resolvedAt: value.resolvedAt
      ? sanitizeDate(value.resolvedAt, `${field}.resolvedAt`)
      : undefined,
  };
}

function sanitizeFileVersion(value: unknown, field: string): ConflictInfo['localVersion'] {
  if (!isPlainObject(value)) {
    throw new Error(`${field} must be an object.`);
  }
  return {
    id: ensureString(value.id, `${field}.id`),
    hash: ensureString(value.hash, `${field}.hash`),
    size: ensureNumber(value.size, `${field}.size`, { min: 0, integer: true }),
    modifiedAt: sanitizeDate(value.modifiedAt ?? new Date(), `${field}.modifiedAt`),
    modifiedBy: ensureString(value.modifiedBy, `${field}.modifiedBy`),
    deviceId: ensureString(value.deviceId, `${field}.deviceId`),
    deviceName: ensureString(value.deviceName, `${field}.deviceName`),
  };
}

function sanitizeVersioningPolicy(value: unknown, field: string): FolderConfig['versioningPolicy'] {
  if (!isPlainObject(value)) {
    throw new Error(`${field} must be an object.`);
  }
  const type = ensureString(value.type ?? 'simple', `${field}.type`, {
    enum: new Set(['simple', 'time-based', 'none']),
  }) as FolderConfig['versioningPolicy']['type'];
  return {
    type,
    keepVersions:
      value.keepVersions === undefined
        ? undefined
        : ensureNumber(value.keepVersions, `${field}.keepVersions`, {
            min: 1,
            max: 100,
            integer: true,
          }),
    keepDays:
      value.keepDays === undefined
        ? undefined
        : ensureNumber(value.keepDays, `${field}.keepDays`, { min: 1, max: 365, integer: true }),
    cleanupInterval:
      value.cleanupInterval === undefined
        ? undefined
        : ensureNumber(value.cleanupInterval, `${field}.cleanupInterval`, {
            min: 1,
            max: 1440,
            integer: true,
          }),
    minDiskSpace:
      value.minDiskSpace === undefined
        ? undefined
        : ensureNumber(value.minDiskSpace, `${field}.minDiskSpace`, { min: 0, integer: true }),
  };
}

function sanitizeDeviceInfo(value: unknown, indexLabel: string): DeviceInfo {
  if (!isPlainObject(value)) {
    throw new Error(`${indexLabel} must be an object.`);
  }
  return {
    id: ensureString(value.id, `${indexLabel}.id`),
    name: ensureString(value.name, `${indexLabel}.name`, { maxLength: 128 }),
    platform: ensureString(value.platform ?? 'win32', `${indexLabel}.platform`, {
      enum: new Set(['darwin', 'win32', 'linux']),
    }) as DeviceInfo['platform'],
    role: value.role === undefined ? undefined : (ensureString(value.role, `${indexLabel}.role`) as 'home' | 'school'),
    status: ensureString(value.status ?? 'offline', `${indexLabel}.status`, {
      enum: new Set(['online', 'offline', 'paused']),
    }) as DeviceInfo['status'],
    address:
      value.address === undefined
        ? undefined
        : ensureString(value.address, `${indexLabel}.address`),
    port:
      value.port === undefined
        ? undefined
        : ensureNumber(value.port, `${indexLabel}.port`, { min: 0, integer: true }),
    lastSeenAt: value.lastSeenAt
      ? sanitizeDate(value.lastSeenAt, `${indexLabel}.lastSeenAt`)
      : undefined,
    pairedAt: sanitizeDate(value.pairedAt ?? new Date(), `${indexLabel}.pairedAt`),
    capabilities: sanitizeDeviceCapabilities(
      value.capabilities ?? {},
      `${indexLabel}.capabilities`
    ),
    publicKey:
      value.publicKey === undefined
        ? undefined
        : ensureString(value.publicKey, `${indexLabel}.publicKey`, { allowEmpty: false }),
  };
}

function sanitizeDeviceCapabilities(value: unknown, field: string): DeviceInfo['capabilities'] {
  if (!isPlainObject(value)) {
    throw new Error(`${field} must be an object.`);
  }
  return {
    maxConnections: ensureNumber(value.maxConnections ?? 5, `${field}.maxConnections`, {
      min: 1,
      max: 100,
      integer: true,
    }),
    compressionEnabled: ensureBoolean(
      value.compressionEnabled ?? true,
      `${field}.compressionEnabled`
    ),
    relayEnabled: ensureBoolean(value.relayEnabled ?? true, `${field}.relayEnabled`),
    natTraversalEnabled: ensureBoolean(
      value.natTraversalEnabled ?? true,
      `${field}.natTraversalEnabled`
    ),
    protocolVersion: ensureString(value.protocolVersion ?? '1.0.0', `${field}.protocolVersion`, {
      allowEmpty: false,
      maxLength: 32,
    }),
  };
}

export function sanitizeConfigPatch(input: unknown): Partial<AppConfig> {
  if (!isPlainObject(input)) {
    throw new Error('Configuration update payload must be an object.');
  }

  const sanitized: Partial<AppConfig> = {};

  for (const [key, value] of Object.entries(input)) {
    switch (key) {
      case 'language':
        sanitized.language = ensureString(value, 'language', {
          enum: ALLOWED_LANGUAGES,
        }) as AppConfig['language'];
        break;
      case 'theme':
        sanitized.theme = ensureString(value, 'theme', {
          enum: ALLOWED_THEMES,
        }) as AppConfig['theme'];
        break;
      case 'ignorePresets':
        sanitized.ignorePresets = Array.isArray(value)
          ? value.map((preset) => sanitizeIgnorePreset(preset))
          : (() => {
              throw new Error('ignorePresets must be an array.');
            })();
        break;
      case 'schedules':
        sanitized.schedules = sanitizeScheduleConfig(value);
        break;
      case 'performance':
        sanitized.performance = sanitizePerformanceConfig(value);
        break;
      case 'security':
        sanitized.security = sanitizeSecurityConfig(value);
        break;
      case 'notifications':
        sanitized.notifications = sanitizeNotificationConfig(value);
        break;
      case 'advanced':
        sanitized.advanced = sanitizeAdvancedConfig(value);
        break;
      case 'onboardingState':
        sanitized.onboardingState = sanitizeOnboardingState(value);
        break;
      default:
        throw new Error(`Field "${key}" is not allowed in configuration update.`);
    }
  }

  return sanitized;
}

export function sanitizeFullConfig(input: unknown, defaults: AppConfig): AppConfig {
  if (!isPlainObject(input)) {
    throw new Error('Configuration import must be an object.');
  }
  const sanitizedFolders = Array.isArray(input.folders)
    ? input.folders.map((folder, folderIndex) =>
        sanitizeFolderConfig(folder, `folders[${folderIndex}]`)
      )
    : defaults.folders;

  sanitizedFolders.forEach((folder, folderIndex) => {
    folder.devices.forEach((deviceId, deviceIndex) => {
      ensureString(deviceId, `folders[${folderIndex}].devices[${deviceIndex}]`, {
        allowEmpty: false,
        maxLength: 64,
      });
    });
  });

  return {
    language: ensureString(input.language ?? defaults.language, 'language', {
      enum: ALLOWED_LANGUAGES,
    }) as AppConfig['language'],
    theme: ensureString(input.theme ?? defaults.theme, 'theme', {
      enum: ALLOWED_THEMES,
    }) as AppConfig['theme'],
    folders: sanitizedFolders,
    devices: Array.isArray(input.devices)
      ? input.devices.map((device, index) => sanitizeDeviceInfo(device, `devices[${index}]`))
      : defaults.devices,
    ignorePresets: Array.isArray(input.ignorePresets)
      ? input.ignorePresets.map((preset) => sanitizeIgnorePreset(preset))
      : defaults.ignorePresets,
    schedules: sanitizeScheduleConfig(input.schedules ?? defaults.schedules),
    performance: sanitizePerformanceConfig(input.performance ?? defaults.performance),
    security: sanitizeSecurityConfig(input.security ?? defaults.security),
    notifications: sanitizeNotificationConfig(input.notifications ?? defaults.notifications),
    advanced: sanitizeAdvancedConfig(input.advanced ?? defaults.advanced),
    onboardingState: input.onboardingState
      ? sanitizeOnboardingState(input.onboardingState)
      : defaults.onboardingState,
  };
}

export function sanitizeFolderInput(input: unknown): {
  path: string;
  name?: string;
  mode?: FolderConfig['mode'];
  devices?: string[];
  ignorePatterns?: string[];
  versioningPolicy?: FolderConfig['versioningPolicy'];
} {
  if (!isPlainObject(input)) {
    throw new Error('Folder payload must be an object.');
  }
  const path = ensureString(input.path, 'folder.path', { maxLength: 4096 });
  return {
    path,
    name:
      input.name === undefined
        ? undefined
        : ensureString(input.name, 'folder.name', { maxLength: 256 }),
    mode:
      input.mode === undefined
        ? undefined
        : (ensureString(input.mode, 'folder.mode', {
            enum: ALLOWED_FOLDER_MODES,
          }) as FolderConfig['mode']),
    devices:
      input.devices === undefined
        ? undefined
        : ensureStringArray(input.devices, 'folder.devices', {
            allowEmpty: true,
            maxEntries: 128,
            maxLength: 64,
          }),
    ignorePatterns:
      input.ignorePatterns === undefined
        ? undefined
        : ensureStringArray(input.ignorePatterns, 'folder.ignorePatterns', {
            allowEmpty: true,
            maxEntries: 512,
            maxLength: 256,
          }),
    versioningPolicy:
      input.versioningPolicy === undefined
        ? undefined
        : sanitizeVersioningPolicy(input.versioningPolicy, 'folder.versioningPolicy'),
  };
}

export function sanitizeFolderUpdate(input: unknown): Partial<FolderConfig> {
  if (!isPlainObject(input)) {
    throw new Error('Folder update payload must be an object.');
  }
  const sanitized: Partial<FolderConfig> = {};
  for (const [key, value] of Object.entries(input)) {
    switch (key) {
      case 'name':
        sanitized.name = ensureString(value, 'folder.name', { maxLength: 256 });
        break;
      case 'mode':
        sanitized.mode = ensureString(value, 'folder.mode', {
          enum: ALLOWED_FOLDER_MODES,
        }) as FolderConfig['mode'];
        break;
      case 'devices':
        sanitized.devices = ensureStringArray(value, 'folder.devices', {
          allowEmpty: true,
          maxEntries: 128,
          maxLength: 64,
        });
        break;
      case 'ignorePatterns':
        sanitized.ignorePatterns = ensureStringArray(value, 'folder.ignorePatterns', {
          allowEmpty: true,
          maxEntries: 512,
          maxLength: 256,
        });
        break;
      case 'versioningPolicy':
        sanitized.versioningPolicy = sanitizeVersioningPolicy(value, 'folder.versioningPolicy');
        break;
      default:
        throw new Error(`Folder field "${key}" cannot be updated through this endpoint.`);
    }
  }
  return sanitized;
}

export function sanitizeDeviceRename(name: unknown): string {
  return ensureString(name, 'device.name', { maxLength: 128 });
}

export function sanitizeDiffPaths(
  filePath1: unknown,
  filePath2: unknown
): { first: string; second: string } {
  return {
    first: ensureString(filePath1, 'path'),
    second: ensureString(filePath2, 'path'),
  };
}

export function sanitizeIgnoreRulesPayload(rules: unknown): string {
  const value = ensureString(rules, 'rules', { allowEmpty: true });
  if (value.length > MAX_IGNORE_RULE_LENGTH) {
    throw new Error('Ignore rules payload exceeds maximum allowed length.');
  }
  return value;
}

export function ensurePairingCode(input: unknown): string {
  const raw = ensureString(input, 'pairingCode', { allowEmpty: false, maxLength: 64 });
  const value = raw.toUpperCase();
  if (value.length < MIN_PAIRING_CODE_LENGTH) {
    throw new Error('Pairing code is too short.');
  }
  if (!/^[A-Z0-9]+$/.test(value)) {
    throw new Error('Pairing code has invalid characters.');
  }
  return value;
}

export function sanitizeLogLines(lines: unknown): number {
  if (lines === undefined || lines === null) {
    return DEFAULT_LOG_LINES;
  }
  const sanitized = ensureNumber(lines, 'lines', { min: 1, max: MAX_LOG_LINES, integer: true });
  return sanitized;
}

export function cloneForStore<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
