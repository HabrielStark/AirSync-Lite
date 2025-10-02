import { EventEmitter } from 'events';
import * as cron from 'node-cron';
import Store from 'electron-store';
import { powerMonitor } from 'electron';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { SyncEngine } from '../sync/syncEngine';
import { AppConfig, QuietHoursRule, NetworkRules } from '../../shared/types/config';
import { logger } from '../utils/logger';

const execAsync = promisify(exec);

const COMMAND_TIMEOUT = 5_000;
const COMMAND_MAX_BUFFER = 1_024 * 1_024;

function stripControlCharacters(value: string): string {
  let result = '';
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code >= 0x20 && code !== 0x7f) {
      result += char;
    }
  }
  return result;
}

function sanitizeShellOutput(output: string): string {
  return stripControlCharacters(output).trim();
}

function sanitizeSsidValue(ssid: string | null): string | null {
  if (!ssid) {
    return null;
  }
  const sanitized = sanitizeShellOutput(ssid).replace(/"/g, '').replace(/\s+/g, ' ');
  return sanitized.length > 256 ? sanitized.slice(0, 256) : sanitized;
}

async function execSafe(command: string): Promise<string> {
  try {
    const { stdout } = await execAsync(command, {
      timeout: COMMAND_TIMEOUT,
      maxBuffer: COMMAND_MAX_BUFFER,
      windowsHide: true,
    });
    return sanitizeShellOutput(stdout);
  } catch (error) {
    if (error && typeof error === 'object' && 'killed' in error && (error as any).killed) {
      logger.warn('Command timed out', { command });
      throw new Error(`Command timed out: ${command}`);
    }
    throw error;
  }
}

export class ScheduleManager extends EventEmitter {
  private quietHoursTasks: Map<string, cron.ScheduledTask> = new Map();
  private batteryMonitorInterval: NodeJS.Timeout | null = null;
  private networkMonitorInterval: NodeJS.Timeout | null = null;
  private currentSSID: string | null = null;
  private isPaused: boolean = false;
  private pauseReasons: Set<string> = new Set();

  constructor(
    private store: Store<AppConfig>,
    private syncEngine: SyncEngine
  ) {
    super();
  }

  async start(): Promise<void> {
    // Set up quiet hours
    this.setupQuietHours();

    // Monitor battery status
    this.startBatteryMonitoring();

    // Monitor network status
    this.startNetworkMonitoring();

    // Monitor power events
    this.setupPowerEventHandlers();

    // Listen for config changes
    this.store.onDidChange('schedules', () => {
      this.setupQuietHours();
    });

    logger.info('Schedule manager started');
  }

  private setupQuietHours(): void {
    // Clear existing tasks
    for (const task of this.quietHoursTasks.values()) {
      task.stop();
    }
    this.quietHoursTasks.clear();

    const quietHours = this.store.get('schedules.quietHours') as QuietHoursRule[];

    for (const rule of quietHours) {
      if (!rule.enabled) continue;

      // Create cron expressions for start and end times
      const [startHour, startMinute] = rule.startTime.split(':').map(Number);
      const [endHour, endMinute] = rule.endTime.split(':').map(Number);

      // Build day of week string
      const daysString = rule.daysOfWeek.length === 7 ? '*' : rule.daysOfWeek.join(',');

      // Schedule start of quiet hours
      const startCron = `${startMinute} ${startHour} * * ${daysString}`;
      const startTask = cron.schedule(startCron, () => {
        this.enterQuietHours(rule);
      });

      // Schedule end of quiet hours
      const endCron = `${endMinute} ${endHour} * * ${daysString}`;
      const endTask = cron.schedule(endCron, () => {
        this.exitQuietHours(rule);
      });

      this.quietHoursTasks.set(`${rule.id}-start`, startTask);
      this.quietHoursTasks.set(`${rule.id}-end`, endTask);

      // Check if we should currently be in quiet hours
      if (this.isInQuietHours(rule)) {
        this.enterQuietHours(rule);
      }
    }

    logger.info(`Set up ${quietHours.length} quiet hours rules`);
  }

  private isInQuietHours(rule: QuietHoursRule): boolean {
    const now = new Date();
    const currentDay = now.getDay();
    const currentTime = now.getHours() * 60 + now.getMinutes();

    // Check if today is included
    if (!rule.daysOfWeek.includes(currentDay)) {
      return false;
    }

    const [startHour, startMinute] = rule.startTime.split(':').map(Number);
    const [endHour, endMinute] = rule.endTime.split(':').map(Number);

    const startTime = startHour * 60 + startMinute;
    const endTime = endHour * 60 + endMinute;

    // Handle overnight quiet hours
    if (startTime > endTime) {
      return currentTime >= startTime || currentTime < endTime;
    } else {
      return currentTime >= startTime && currentTime < endTime;
    }
  }

  private enterQuietHours(rule: QuietHoursRule): void {
    logger.info(`Entering quiet hours: ${rule.name}`);

    switch (rule.action) {
      case 'pause':
        this.pauseSync(`quiet-hours-${rule.id}`);
        break;

      case 'limit-speed':
        if (rule.speedLimit) {
          this.setSpeedLimit(rule.speedLimit);
        }
        break;

      case 'disable-notifications':
        this.disableNotifications();
        break;
    }

    this.emit('quiet-hours-entered', rule);
  }

  private exitQuietHours(rule: QuietHoursRule): void {
    logger.info(`Exiting quiet hours: ${rule.name}`);

    switch (rule.action) {
      case 'pause':
        this.resumeSync(`quiet-hours-${rule.id}`);
        break;

      case 'limit-speed':
        this.clearSpeedLimit();
        break;

      case 'disable-notifications':
        this.enableNotifications();
        break;
    }

    this.emit('quiet-hours-exited', rule);
  }

  private startBatteryMonitoring(): void {
    // Check battery status every minute
    this.batteryMonitorInterval = setInterval(() => {
      this.checkBatteryStatus();
    }, 60000);

    // Initial check
    this.checkBatteryStatus();
  }

  private async checkBatteryStatus(): Promise<void> {
    const onBattery = powerMonitor.isOnBatteryPower();

    if (!onBattery) {
      // On AC power, remove battery-related pause
      this.resumeSync('low-battery');
      this.resumeSync('power-save-mode');
      return;
    }

    // Check battery level (platform-specific)
    const batteryLevel = await this.getBatteryLevel();
    const pauseOnLowBattery = this.store.get('performance.pauseOnLowBattery');
    const batteryThreshold = this.store.get('performance.batteryThreshold') as number;

    if (pauseOnLowBattery && batteryLevel < batteryThreshold) {
      logger.info(
        `Battery level ${batteryLevel}% below threshold ${batteryThreshold}%, pausing sync`
      );
      this.pauseSync('low-battery');
    } else {
      this.resumeSync('low-battery');
    }

    // Check power save mode
    const pauseOnPowerSave = this.store.get('performance.pauseOnPowerSave');
    if (pauseOnPowerSave && this.isInPowerSaveMode()) {
      logger.info('Power save mode detected, pausing sync');
      this.pauseSync('power-save-mode');
    } else {
      this.resumeSync('power-save-mode');
    }
  }

  private async getBatteryLevel(): Promise<number> {
    // Platform-specific battery level detection
    try {
      if (process.platform === 'darwin') {
        const output = await execSafe('pmset -g batt');
        const match = output.match(/(\d+)%/);
        return match ? parseInt(match[1], 10) : 100;
      }
      if (process.platform === 'win32') {
        const output = await execSafe('WMIC Path Win32_Battery Get EstimatedChargeRemaining');
        const lines = output
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);
        if (lines.length >= 2) {
          return parseInt(lines[1], 10) || 100;
        }
      }
      if (process.platform === 'linux') {
        const output = await execSafe('cat /sys/class/power_supply/BAT0/capacity');
        const value = parseInt(output, 10);
        if (!Number.isNaN(value)) {
          return value;
        }
      }
    } catch (error) {
      logger.error('Failed to get battery level:', error);
    }

    return 100; // Default to full battery
  }

  private isInPowerSaveMode(): boolean {
    // Platform-specific power save mode detection
    // This is a simplified implementation
    return false;
  }

  private startNetworkMonitoring(): void {
    // Check network status every 30 seconds
    this.networkMonitorInterval = setInterval(() => {
      this.checkNetworkStatus();
    }, 30000);

    // Initial check
    this.checkNetworkStatus();

    // Monitor network changes
    // Note: net doesn't have event emitter functionality
    // In production, you would use a proper network monitoring library
  }

  private async checkNetworkStatus(): Promise<void> {
    try {
      // Get current SSID
      this.currentSSID = await this.getCurrentSSID();

      const networkRules = this.store.get('schedules.networkRules') as NetworkRules;

      // Check if we should pause based on network rules
      if (this.currentSSID) {
        // Check blocked SSIDs
        if (networkRules.blockedSSIDs.includes(this.currentSSID)) {
          logger.info(`Connected to blocked SSID: ${this.currentSSID}, pausing sync`);
          this.pauseSync('blocked-network');
        } else if (
          networkRules.allowedSSIDs.length > 0 &&
          !networkRules.allowedSSIDs.includes(this.currentSSID)
        ) {
          // If whitelist is defined and current SSID is not in it
          logger.info(`Connected to non-whitelisted SSID: ${this.currentSSID}, pausing sync`);
          this.pauseSync('non-whitelisted-network');
        } else {
          // Network is allowed
          this.resumeSync('blocked-network');
          this.resumeSync('non-whitelisted-network');
        }
      }

      // Check metered connection
      if (this.isMeteredConnection()) {
        this.handleMeteredConnection(networkRules);
      } else {
        this.resumeSync('metered-connection');
      }

      // Check LAN-only mode
      if (networkRules.lanOnly && !this.isOnLAN()) {
        logger.info('Not on LAN and LAN-only mode is enabled, pausing sync');
        this.pauseSync('lan-only');
      } else {
        this.resumeSync('lan-only');
      }
    } catch (error) {
      logger.error('Failed to check network status:', error);
    }
  }

  private isMeteredConnection(): boolean {
    // Check if on metered connection
    // This is platform-specific and would need proper implementation
    return false;
  }

  private isOnLAN(): boolean {
    // Check if connected to local network
    // Simple check based on private IP ranges
    const interfaces = os.networkInterfaces();

    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]!) {
        if (iface.family === 'IPv4' && !iface.internal) {
          const parts = iface.address.split('.');
          const firstOctet = parseInt(parts[0]);
          const secondOctet = parseInt(parts[1]);

          // Check for private IP ranges
          if (
            firstOctet === 10 ||
            (firstOctet === 172 && secondOctet >= 16 && secondOctet <= 31) ||
            (firstOctet === 192 && secondOctet === 168)
          ) {
            return true;
          }
        }
      }
    }

    return false;
  }

  private handleMeteredConnection(networkRules: NetworkRules): void {
    switch (networkRules.meteringBehavior) {
      case 'pause':
        this.pauseSync('metered-connection');
        break;

      case 'limit-speed':
        if (networkRules.meteringSpeedLimit) {
          this.setSpeedLimit(networkRules.meteringSpeedLimit);
        }
        break;

      case 'normal':
      default:
        this.resumeSync('metered-connection');
        break;
    }
  }

  private setupPowerEventHandlers(): void {
    powerMonitor.on('suspend', () => {
      logger.info('System suspending, pausing sync');
      this.pauseSync('system-suspend');
    });

    powerMonitor.on('resume', () => {
      logger.info('System resumed');
      this.resumeSync('system-suspend');

      // Re-check all conditions after resume
      this.checkBatteryStatus();
      this.checkNetworkStatus();
    });

    powerMonitor.on('lock-screen', () => {
      // Optionally pause on screen lock
      const pauseOnLock = this.store.get('security.pauseOnLock' as any);
      if (pauseOnLock) {
        logger.info('Screen locked, pausing sync');
        this.pauseSync('screen-lock');
      }
    });

    powerMonitor.on('unlock-screen', () => {
      this.resumeSync('screen-lock');
    });
  }

  private pauseSync(reason: string): void {
    this.pauseReasons.add(reason);

    if (!this.isPaused) {
      this.isPaused = true;
      this.syncEngine.pauseSync();
      this.emit('sync-paused', Array.from(this.pauseReasons));
      logger.info(`Sync paused. Reasons: ${Array.from(this.pauseReasons).join(', ')}`);
    }
  }

  private resumeSync(reason: string): void {
    this.pauseReasons.delete(reason);

    if (this.isPaused && this.pauseReasons.size === 0) {
      this.isPaused = false;
      this.syncEngine.resumeSync();
      this.emit('sync-resumed');
      logger.info('Sync resumed');
    }
  }

  private setSpeedLimit(limitKBps: number): void {
    // Update speed limits in store
    const currentConfig = this.store.get('performance');
    this.store.set('performance', {
      ...currentConfig,
      uploadLimit: limitKBps,
      downloadLimit: limitKBps,
    });

    this.emit('speed-limit-changed', limitKBps);
  }

  private clearSpeedLimit(): void {
    const currentConfig = this.store.get('performance');
    this.store.set('performance', {
      ...currentConfig,
      uploadLimit: 0,
      downloadLimit: 0,
    });

    this.emit('speed-limit-cleared');
  }

  private disableNotifications(): void {
    const currentConfig = this.store.get('notifications');
    this.store.set('notifications', {
      ...currentConfig,
      enabled: false,
    });
  }

  private enableNotifications(): void {
    const currentConfig = this.store.get('notifications');
    this.store.set('notifications', {
      ...currentConfig,
      enabled: true,
    });
  }

  private async getCurrentSSID(): Promise<string | null> {
    try {
      if (process.platform === 'darwin') {
        const output = await execSafe(
          '/System/Library/PrivateFrameworks/Apple80211.framework/Versions/A/Resources/airport -I'
        );
        const match = output.match(/\s+SSID:\s+(.+)/);
        return sanitizeSsidValue(match ? match[1] : null);
      }
      if (process.platform === 'win32') {
        const output = await execSafe('netsh wlan show interfaces');
        const match = output.match(/\s+SSID\s+:\s+(.+)/);
        return sanitizeSsidValue(match ? match[1] : null);
      }
      if (process.platform === 'linux') {
        const output = await execSafe('iwgetid -r');
        return sanitizeSsidValue(output);
      }
    } catch (error) {
      logger.debug('Failed to get current SSID:', error);
    }
    return null;
  }

  getCurrentSSIDSync(): string | null {
    return this.currentSSID;
  }

  getStatus(): {
    isPaused: boolean;
    pauseReasons: string[];
    activeQuietHours: QuietHoursRule[];
    currentSSID: string | null;
    batteryLevel: number | null;
  } {
    const activeQuietHours = (this.store.get('schedules.quietHours') as QuietHoursRule[]).filter(
      (rule) => rule.enabled && this.isInQuietHours(rule)
    );

    return {
      isPaused: this.isPaused,
      pauseReasons: Array.from(this.pauseReasons),
      activeQuietHours,
      currentSSID: this.currentSSID,
      batteryLevel: null, // Would be set by battery monitoring
    };
  }

  stop(): void {
    // Stop all scheduled tasks
    for (const task of this.quietHoursTasks.values()) {
      task.stop();
    }
    this.quietHoursTasks.clear();

    // Clear intervals
    if (this.batteryMonitorInterval) {
      clearInterval(this.batteryMonitorInterval);
      this.batteryMonitorInterval = null;
    }

    if (this.networkMonitorInterval) {
      clearInterval(this.networkMonitorInterval);
      this.networkMonitorInterval = null;
    }

    logger.info('Schedule manager stopped');
  }
}
