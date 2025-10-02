export interface RendererLogger {
  error: (message: string, error?: unknown) => void;
  warn: (message: string, error?: unknown) => void;
  info: (message: string, payload?: unknown) => void;
  debug: (message: string, payload?: unknown) => void;
}

function sendToMain(
  level: 'error' | 'warn' | 'info' | 'debug',
  message: string,
  payload?: unknown
): void {
  if (typeof window !== 'undefined' && (window as any).electronAPI?.logToMain) {
    (window as any).electronAPI.logToMain({ level, message, payload, timestamp: Date.now() });
  }
}

export const rendererLogger: RendererLogger = {
  error(message, error) {
    sendToMain('error', message, serializeError(error));
  },
  warn(message, payload) {
    sendToMain('warn', message, payload);
  },
  info(message, payload) {
    sendToMain('info', message, payload);
  },
  debug(message, payload) {
    if (process.env.NODE_ENV !== 'production') {
      sendToMain('debug', message, payload);
    }
  },
};

function serializeError(error?: unknown): unknown {
  if (!error) return undefined;
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
      name: error.name,
    };
  }
  return error;
}
