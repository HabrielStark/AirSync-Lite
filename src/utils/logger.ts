/**
 * Renderer process logger that forwards logs to main process via IPC
 * Provides unified logging interface for React components
 */

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

interface LogMessage {
  level: LogLevel;
  message: string;
  timestamp: number;
  data?: any;
}

class RendererLogger {
  private pendingLogs: LogMessage[] = [];
  private ipcAvailable = false;

  constructor() {
    // Check if electron IPC is available
    if (typeof window !== 'undefined' && (window as any).electronAPI) {
      this.ipcAvailable = true;
      this.flushPendingLogs();
    }
  }

  private flushPendingLogs(): void {
    if (this.ipcAvailable && this.pendingLogs.length > 0) {
      this.pendingLogs.forEach((log) => this.sendToMain(log));
      this.pendingLogs = [];
    }
  }

  private sendToMain(log: LogMessage): void {
    if (this.ipcAvailable) {
      (window as any).electronAPI?.logToMain?.(log);
    } else {
      // Fallback to console if IPC not available
      this.pendingLogs.push(log);
      console[log.level](log.message, log.data);
    }
  }

  private log(level: LogLevel, message: string, ...args: any[]): void {
    const logMessage: LogMessage = {
      level,
      message,
      timestamp: Date.now(),
      data: args.length > 0 ? args : undefined,
    };

    this.sendToMain(logMessage);
  }

  error(message: string, ...args: any[]): void {
    this.log('error', message, ...args);
  }

  warn(message: string, ...args: any[]): void {
    this.log('warn', message, ...args);
  }

  info(message: string, ...args: any[]): void {
    this.log('info', message, ...args);
  }

  debug(message: string, ...args: any[]): void {
    this.log('debug', message, ...args);
  }
}

export const logger = new RendererLogger();
