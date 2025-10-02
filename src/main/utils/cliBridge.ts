import fs from 'fs';
import net, { Server } from 'net';
import { logger } from './logger';
import { getCliBridgePath } from '../../shared/constants/cliBridge';
import { FileEntry } from '../../shared/types/sync';

export type CliAction = 'sync' | 'status-tree';

export interface CliRequest {
  action: CliAction;
  folderId?: string;
}

export interface CliSyncResponse {
  success: boolean;
  message?: string;
}

export interface CliStatusTreeResponse {
  folderId: string;
  files: FileEntry[];
}

export interface CliBridgeHandlers {
  sync: (folderId?: string) => Promise<CliSyncResponse>;
  statusTree: (folderId: string) => Promise<CliStatusTreeResponse>;
}

export interface CliBridgeServer {
  server: Server;
  socketPath: string;
  close: () => Promise<void>;
}

export async function handleCliRequest(
  payload: CliRequest,
  handlers: CliBridgeHandlers
): Promise<unknown> {
  switch (payload.action) {
    case 'sync':
      return handlers.sync(payload.folderId);
    case 'status-tree':
      if (!payload.folderId) {
        throw new Error('folderId is required for status-tree');
      }
      return handlers.statusTree(payload.folderId);
    default:
      throw new Error(`Unsupported CLI action: ${payload.action}`);
  }
}

export function createCliBridgeServer(handlers: CliBridgeHandlers): CliBridgeServer {
  const socketPath = getCliBridgePath();

  if (process.platform !== 'win32' && fs.existsSync(socketPath)) {
    try {
      fs.unlinkSync(socketPath);
    } catch (error) {
      logger.warn('Failed to remove stale CLI socket', error);
    }
  }

  const server = net.createServer((socket) => {
    let buffer = '';
    socket.setEncoding('utf-8');

    socket.on('data', (chunk) => {
      buffer += chunk;
    });

    socket.on('end', async () => {
      try {
        const payload = JSON.parse(buffer) as CliRequest;
        const result = await handleCliRequest(payload, handlers);
        socket.end(`${JSON.stringify({ success: true, data: result })}\n`);
      } catch (error) {
        logger.error('CLI bridge request failed', error);
        socket.end(
          `${JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          })}\n`
        );
      }
    });

    socket.on('error', (error) => {
      logger.warn('CLI bridge socket error', error);
    });
  });

  server.on('error', (error) => {
    logger.error('CLI bridge server error', error);
  });

  server.listen(socketPath, () => {
    logger.info(`CLI bridge listening on ${socketPath}`);
  });

  return {
    server,
    socketPath,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });

      if (process.platform !== 'win32' && fs.existsSync(socketPath)) {
        try {
          fs.unlinkSync(socketPath);
        } catch (error) {
          logger.warn('Failed to unlink CLI socket on close', error);
        }
      }
    },
  };
}

// Exposed for testing without opening sockets
