import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { promisify } from 'util';
import Store from 'electron-store';
import PQueue from 'p-queue';
import { v4 as uuidv4 } from 'uuid';
import { NetworkManager } from '../network/networkManager';
import { FolderConfig, FileInfo, TransferProgress } from '../../shared/types/sync';
import { AppConfig } from '../../shared/types/config';
import { logger } from '../utils/logger';
import { validateSyncPath } from '../utils/pathSecurity';
import type {
  TransferChunkMessage,
  TransferCompleteMessage,
  TransferErrorMessage,
  TransferInitMessage,
  TransferRequestMessage,
} from '../../shared/types/transfer';
// ✅ CRITICAL FIX: Use promisified zlib instead of callbacks
import { deflate as deflateCallback, inflate as inflateCallback } from 'zlib';
const deflate = promisify(deflateCallback);
const inflate = promisify(inflateCallback);

interface Transfer {
  id: string;
  type: 'upload' | 'download';
  folderId: string;
  file: FileInfo;
  deviceId: string;
  status: 'pending' | 'active' | 'completed' | 'failed' | 'cancelled';
  progress: TransferProgress;
  error?: Error;
  retryCount: number;
  tempFilePath?: string;
}

interface DownloadSession {
  transfer: Transfer;
  folderPath: string;
  targetPath: string;
  tempFilePath: string;
  fileHandle: fs.FileHandle;
  totalChunks: number;
  chunkSize: number;
  compressed: boolean;
  receivedChunks: number;
  hash: crypto.Hash;
}

export class TransferManager extends EventEmitter {
  private transfers: Map<string, Transfer> = new Map();
  private queues: Map<string, PQueue> = new Map();
  private activeTransfers: Map<string, NodeJS.Timeout> = new Map();
  private downloadSessions: Map<string, DownloadSession> = new Map();
  private readonly CHUNK_SIZE = 1024 * 1024; // 1MB chunks
  private readonly MAX_RETRIES = 3;
  private readonly TRANSFER_TIMEOUT = 30000; // 30 seconds per chunk

  constructor(
    private store: Store<AppConfig>,
    private networkManager: NetworkManager
  ) {
    super();
  }

  async initialize(): Promise<void> {
    this.networkManager.on('transfer-request', async ({ deviceId, payload }) => {
      await this.handleOutgoingFileRequest(deviceId, payload);
    });

    this.networkManager.on('transfer-init', ({ deviceId, payload }) => {
      void this.handleIncomingInit(deviceId, payload);
    });

    this.networkManager.on('transfer-chunk', ({ deviceId, payload }) => {
      void this.handleIncomingChunk(deviceId, payload);
    });

    this.networkManager.on('transfer-complete', ({ deviceId, payload }) => {
      void this.handleTransferComplete(deviceId, payload);
    });

    this.networkManager.on('transfer-error', ({ deviceId, payload }) => {
      this.handleTransferError(deviceId, payload);
    });

    logger.info('Transfer manager initialized');
  }

  async uploadFile(folder: FolderConfig, file: FileInfo, deviceId: string): Promise<void> {
    const transferId = uuidv4();
    const transfer: Transfer = {
      id: transferId,
      type: 'upload',
      folderId: folder.id,
      file,
      deviceId,
      status: 'pending',
      progress: {
        fileId: file.path,
        fileName: file.name,
        fromDevice: this.networkManager.getDeviceId(),
        toDevice: deviceId,
        bytesTransferred: 0,
        totalBytes: file.size,
        speed: 0,
        eta: 0,
        startedAt: new Date(),
      },
      retryCount: 0,
    };

    this.transfers.set(transferId, transfer);

    // Add to device queue
    const queue = this.getOrCreateQueue(deviceId);
    await queue.add(() => this.executeUpload(transfer));
  }

  async downloadFile(folder: FolderConfig, file: FileInfo, deviceId: string): Promise<void> {
    const transferId = uuidv4();
    const transfer: Transfer = {
      id: transferId,
      type: 'download',
      folderId: folder.id,
      file,
      deviceId,
      status: 'pending',
      progress: {
        fileId: file.path,
        fileName: file.name,
        fromDevice: deviceId,
        toDevice: this.networkManager.getDeviceId(),
        bytesTransferred: 0,
        totalBytes: file.size,
        speed: 0,
        eta: 0,
        startedAt: new Date(),
      },
      retryCount: 0,
    };

    this.transfers.set(transferId, transfer);

    // Add to device queue
    const queue = this.getOrCreateQueue(deviceId);
    await queue.add(() => this.executeDownload(transfer));
  }

  private getOrCreateQueue(deviceId: string): PQueue {
    if (!this.queues.has(deviceId)) {
      const queue = new PQueue({
        concurrency: this.store.get('performance.maxConcurrentTransfers') || 3,
        interval: 1000,
        intervalCap: 10,
      });
      this.queues.set(deviceId, queue);
    }
    return this.queues.get(deviceId)!;
  }

  private async executeUpload(transfer: Transfer): Promise<void> {
    try {
      transfer.status = 'active';
      this.emit('transfer-started', transfer);

      const filePath = transfer.file.path;
      const fileHandle = await fs.open(filePath, 'r');

      try {
        const stats = await fileHandle.stat();
        const totalChunks = Math.ceil(stats.size / this.CHUNK_SIZE);

        await this.sendTransferInit(transfer, totalChunks);

        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
          const buffer = Buffer.alloc(this.CHUNK_SIZE);
          const { bytesRead } = await fileHandle.read(
            buffer,
            0,
            this.CHUNK_SIZE,
            chunkIndex * this.CHUNK_SIZE
          );

          const chunk = buffer.slice(0, bytesRead);
          const payload = this.store.get('performance.compressionEnabled')
            ? await this.compressChunk(chunk)
            : chunk;

          await this.sendChunk(transfer, chunkIndex, payload);

          transfer.progress.bytesTransferred += bytesRead;
          this.updateTransferProgress(transfer);
        }

        await this.sendTransferComplete(transfer);

        transfer.status = 'completed';
        transfer.progress.completedAt = new Date();
        this.emit('transfer-complete', transfer);
      } finally {
        await fileHandle.close();
      }
    } catch (error) {
      await this.handleTransferFailure(transfer, error);
    } finally {
      this.transfers.delete(transfer.id);
    }
  }

  private async executeDownload(transfer: Transfer): Promise<void> {
    try {
      transfer.status = 'active';
      this.emit('transfer-started', transfer);

      await this.requestFile(transfer);
      await this.waitForTransfer(transfer);
    } catch (error) {
      await this.handleTransferFailure(transfer, error);
    }
  }

  private async sendTransferInit(transfer: Transfer, totalChunks: number): Promise<void> {
    const connection = this.networkManager.getConnection(transfer.deviceId);
    if (!connection) {
      throw new Error(`Not connected to device ${transfer.deviceId}`);
    }

    const initData = {
      transferId: transfer.id,
      file: {
        path: transfer.file.relativePath,
        name: transfer.file.name,
        size: transfer.file.size,
        hash: transfer.file.hash,
        modifiedAt: transfer.file.modifiedAt,
      },
      totalChunks,
      chunkSize: this.CHUNK_SIZE,
      compressed: this.store.get('performance.compressionEnabled'),
    } satisfies TransferInitMessage;

    connection.socket.emit('transfer-init', initData);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Transfer initialization timeout')),
        this.TRANSFER_TIMEOUT
      );

      connection.socket.once(`transfer-init-ack:${transfer.id}`, () => {
        clearTimeout(timeout);
        resolve();
      });

      connection.socket.once(`transfer-init-error:${transfer.id}`, (error) => {
        clearTimeout(timeout);
        reject(new Error(error.message ?? error));
      });
    });
  }

  private async sendChunk(transfer: Transfer, chunkIndex: number, chunk: Buffer): Promise<void> {
    const connection = this.networkManager.getConnection(transfer.deviceId);
    if (!connection) {
      throw new Error(`Not connected to device ${transfer.deviceId}`);
    }

    const chunkData: TransferChunkMessage = {
      transferId: transfer.id,
      chunkIndex,
      data: chunk.toString('base64'),
      hash: crypto.createHash('sha256').update(chunk).digest('hex'),
    };

    connection.socket.emit('transfer-chunk', chunkData);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`Chunk ${chunkIndex} transfer timeout`)),
        this.TRANSFER_TIMEOUT
      );

      connection.socket.once(`chunk-ack:${transfer.id}:${chunkIndex}`, () => {
        clearTimeout(timeout);
        resolve();
      });

      connection.socket.once(`chunk-error:${transfer.id}:${chunkIndex}`, (error) => {
        clearTimeout(timeout);
        reject(new Error(error.message ?? error));
      });
    });
  }

  private async sendTransferComplete(transfer: Transfer): Promise<void> {
    const connection = this.networkManager.getConnection(transfer.deviceId);
    if (!connection) {
      throw new Error(`Not connected to device ${transfer.deviceId}`);
    }

    const message: TransferCompleteMessage = {
      transferId: transfer.id,
      fileHash: transfer.file.hash,
    };

    connection.socket.emit('transfer-complete', message);
  }

  private async requestFile(transfer: Transfer): Promise<void> {
    const connection = this.networkManager.getConnection(transfer.deviceId);
    if (!connection) {
      throw new Error(`Not connected to device ${transfer.deviceId}`);
    }

    const request: TransferRequestMessage = {
      transferId: transfer.id,
      folderId: transfer.folderId,
      relativePath: transfer.file.relativePath,
      hash: transfer.file.hash,
    };

    connection.socket.emit('request-file', request);
  }

  private async waitForTransfer(transfer: Transfer): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Transfer timeout'));
      }, this.TRANSFER_TIMEOUT * 100);

      const checkComplete = setInterval(() => {
        if (transfer.status === 'completed') {
          clearInterval(checkComplete);
          clearTimeout(timeout);
          resolve();
        } else if (transfer.status === 'failed') {
          clearInterval(checkComplete);
          clearTimeout(timeout);
          reject(transfer.error || new Error('Transfer failed'));
        }
      }, 100);

      this.activeTransfers.set(transfer.id, checkComplete);
    });
  }

  private async handleOutgoingFileRequest(
    deviceId: string,
    payload: TransferRequestMessage
  ): Promise<void> {
    try {
      const folders = this.store.get('folders');
      const folder = folders.find((f) => f.id === payload.folderId);
      if (!folder) {
        throw new Error(`Folder not found: ${payload.folderId}`);
      }

      const transfer = Array.from(this.transfers.values()).find(
        (t) => t.id === payload.transferId && t.deviceId === deviceId && t.type === 'upload'
      );

      if (transfer) {
        const queue = this.getOrCreateQueue(deviceId);
        await queue.add(() => this.executeUpload(transfer));
      } else {
        logger.warn(`No pending upload transfer ${payload.transferId} for device ${deviceId}`);
      }
    } catch (error) {
      logger.error('Failed to handle transfer request', error);
      this.networkManager.emitTo(deviceId, 'transfer-error', {
        transferId: payload.transferId,
        error: (error as Error).message,
      } satisfies TransferErrorMessage);
    }
  }

  private async handleIncomingInit(deviceId: string, payload: TransferInitMessage): Promise<void> {
    const transfer = this.transfers.get(payload.transferId);
    if (!transfer) {
      logger.warn(`No transfer found for init ${payload.transferId}`);
      return;
    }

    const folders = this.store.get('folders');
    const folder = folders.find((f) => f.id === transfer.folderId);
    if (!folder) {
      logger.error(`Folder not found for transfer ${payload.transferId}`);
      return;
    }

    const folderPath = folder.path;

    // ✅ SECURITY FIX: Validate path to prevent traversal attacks
    let targetPath: string;
    try {
      targetPath = validateSyncPath(payload.file.path, folderPath);
    } catch (error) {
      logger.error(
        `Path traversal attempt detected for transfer ${payload.transferId}: ${payload.file.path}`,
        error
      );
      this.emit('transfer-failed', transfer);
      return;
    }

    const tempFilePath = `${targetPath}.part-${payload.transferId}`;
    await fs.mkdir(path.dirname(targetPath), { recursive: true });

    const fileHandle = await fs.open(tempFilePath, 'w');

    const session: DownloadSession = {
      transfer,
      folderPath,
      targetPath,
      tempFilePath,
      fileHandle,
      totalChunks: payload.totalChunks,
      chunkSize: payload.chunkSize,
      compressed: payload.compressed,
      receivedChunks: 0,
      hash: crypto.createHash('sha256'),
    };

    this.downloadSessions.set(payload.transferId, session);
    this.networkManager.emitTo(deviceId, `transfer-init-ack:${payload.transferId}`, {});
  }

  private async handleIncomingChunk(
    deviceId: string,
    payload: TransferChunkMessage
  ): Promise<void> {
    const session = this.downloadSessions.get(payload.transferId);
    if (!session) {
      logger.warn(`No download session for transfer ${payload.transferId}`);
      return;
    }

    try {
      const expectedHash = payload.hash;
      const rawBuffer = Buffer.from(payload.data, 'base64');
      const computedHash = crypto.createHash('sha256').update(rawBuffer).digest('hex');

      if (computedHash !== expectedHash) {
        throw new Error(`Chunk hash mismatch for transfer ${payload.transferId}`);
      }

      const chunkBuffer = session.compressed ? await this.decompressChunk(rawBuffer) : rawBuffer;
      await session.fileHandle.write(
        chunkBuffer,
        0,
        chunkBuffer.length,
        payload.chunkIndex * session.chunkSize
      );

      session.hash.update(chunkBuffer);
      session.receivedChunks += 1;

      session.transfer.progress.bytesTransferred += chunkBuffer.length;
      this.updateTransferProgress(session.transfer);

      this.networkManager.emitTo(
        deviceId,
        `chunk-ack:${payload.transferId}:${payload.chunkIndex}`,
        {}
      );
    } catch (error) {
      logger.error('Failed to process transfer chunk', error);
      this.networkManager.emitTo(
        deviceId,
        `chunk-error:${payload.transferId}:${payload.chunkIndex}`,
        {
          message: (error as Error).message,
        }
      );
    }
  }

  private async handleTransferComplete(
    deviceId: string,
    payload: TransferCompleteMessage
  ): Promise<void> {
    const session = this.downloadSessions.get(payload.transferId);
    if (!session) {
      logger.warn(`No download session found for transfer complete ${payload.transferId}`);
      return;
    }

    try {
      await session.fileHandle.close();

      const finalHash = session.hash.digest('hex');
      if (payload.fileHash && payload.fileHash !== finalHash) {
        throw new Error('File hash mismatch on completion');
      }

      await fs.rename(session.tempFilePath, session.targetPath);

      session.transfer.status = 'completed';
      session.transfer.progress.completedAt = new Date();
      this.emit('transfer-complete', session.transfer);
      this.downloadSessions.delete(payload.transferId);
    } catch (error) {
      await fs.rm(session.tempFilePath, { force: true }).catch(() => undefined);
      await this.handleTransferFailure(session.transfer, error);
      this.downloadSessions.delete(payload.transferId);
    }
  }

  private handleTransferError(deviceId: string, payload: TransferErrorMessage): void {
    const transfer = this.transfers.get(payload.transferId);
    if (transfer) {
      transfer.error = new Error(payload.error);
      void this.handleTransferFailure(transfer, transfer.error);
    }

    const session = this.downloadSessions.get(payload.transferId);
    if (session) {
      void fs.rm(session.tempFilePath, { force: true }).catch(() => undefined);
      this.downloadSessions.delete(payload.transferId);
    }
  }

  private async handleTransferFailure(transfer: Transfer, error: any): Promise<void> {
    logger.error(`Transfer failed: ${transfer.id}`, error);

    transfer.error = error;
    transfer.retryCount++;

    if (transfer.retryCount < this.MAX_RETRIES) {
      // Retry transfer
      logger.info(`Retrying transfer ${transfer.id} (attempt ${transfer.retryCount + 1})`);

      await new Promise((resolve) => setTimeout(resolve, 1000 * transfer.retryCount));

      if (transfer.type === 'upload') {
        await this.executeUpload(transfer);
      } else {
        await this.executeDownload(transfer);
      }
    } else {
      // Max retries reached
      transfer.status = 'failed';
      this.emit('transfer-failed', transfer);
      this.transfers.delete(transfer.id);
    }
  }

  private async updateTransferProgress(transfer: Transfer): Promise<void> {
    const now = Date.now();
    const elapsed = now - transfer.progress.startedAt.getTime();
    const speed = (transfer.progress.bytesTransferred / elapsed) * 1000; // bytes/second

    transfer.progress.speed = speed;

    if (speed > 0) {
      const remaining = transfer.progress.totalBytes - transfer.progress.bytesTransferred;
      transfer.progress.eta = Math.round(remaining / speed);
    }

    // ✅ CRITICAL FIX: Implement actual throttling logic
    const uploadLimit = (this.store.get('performance.uploadLimit') as number) * 1024; // Convert KB/s to bytes/s
    const downloadLimit = (this.store.get('performance.downloadLimit') as number) * 1024;

    if (transfer.type === 'upload' && uploadLimit > 0 && speed > uploadLimit) {
      // Calculate delay needed to match target speed
      const excessSpeed = speed - uploadLimit;
      const delayMs = (excessSpeed / uploadLimit) * 1000;
      await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, 1000)));
    }

    if (transfer.type === 'download' && downloadLimit > 0 && speed > downloadLimit) {
      // Calculate delay needed to match target speed
      const excessSpeed = speed - downloadLimit;
      const delayMs = (excessSpeed / downloadLimit) * 1000;
      await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, 1000)));
    }

    this.emit('transfer-progress', transfer.progress);
  }

  private async compressChunk(chunk: Buffer): Promise<Buffer> {
    // ✅ FIX: Use promisified zlib
    const level = (this.store.get('performance.compressionLevel') as number | undefined) ?? 6;
    return await deflate(chunk, { level });
  }

  private async decompressChunk(chunk: Buffer): Promise<Buffer> {
    // ✅ FIX: Use promisified zlib
    return await inflate(chunk);
  }

  getActiveTransfers(): Transfer[] {
    return Array.from(this.transfers.values()).filter((t) => t.status === 'active');
  }

  getPendingTransfers(): Transfer[] {
    return Array.from(this.transfers.values()).filter((t) => t.status === 'pending');
  }

  async cancelTransfer(transferId: string): Promise<void> {
    const transfer = this.transfers.get(transferId);
    if (transfer) {
      transfer.status = 'cancelled';

      // Remove from queue
      const queue = this.queues.get(transfer.deviceId);
      if (queue) {
        queue.clear();
      }

      // Clean up active transfer tracking
      const interval = this.activeTransfers.get(transferId);
      if (interval) {
        clearInterval(interval);
        this.activeTransfers.delete(transferId);
      }

      this.transfers.delete(transferId);
      this.emit('transfer-cancelled', transfer);
    }
  }

  async stop(): Promise<void> {
    for (const transfer of this.transfers.values()) {
      await this.cancelTransfer(transfer.id);
    }

    for (const queue of this.queues.values()) {
      queue.clear();
      await queue.onIdle();
    }

    this.queues.clear();
    this.transfers.clear();
    this.activeTransfers.clear();

    for (const session of this.downloadSessions.values()) {
      await session.fileHandle.close().catch(() => undefined);
      await fs.rm(session.tempFilePath, { force: true }).catch(() => undefined);
    }
    this.downloadSessions.clear();

    logger.info('Transfer manager stopped');
  }
}
