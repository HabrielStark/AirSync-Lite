const DEFAULT_IGNORE_PATTERNS = [
  '**/.git',
  '**/node_modules',
  '**/.DS_Store',
  '**/Thumbs.db',
  '**/*.tmp',
  '**/~*',
];
import { EventEmitter } from 'events';
import http, { Server as HttpServer } from 'http';
import https, { Server as HttpsServer } from 'https';
import os from 'os';
import QRCode from 'qrcode';
import { Server as SocketIOServer, Socket as ServerSocket } from 'socket.io';
import { io as SocketIOClient, Socket as ClientSocket } from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';
import Store from 'electron-store';
import { logger } from '../utils/logger';
import type {
  TransferInitMessage,
  TransferChunkMessage,
  TransferCompleteMessage,
  TransferErrorMessage,
  TransferRequestMessage,
} from '../../shared/types/transfer';
import { DiscoveryService } from './discoveryService';
import { NATTraversal } from './natTraversal';
import { SecureChannel } from './secureChannel';
import { PeerRegistry, PeerInfo } from './PeerRegistry';
import { MessageBus } from './MessageBus';
import { ProtocolMessage } from './protocol/Protocol';
import { RateLimiter } from './security/RateLimiter';
import { IntrusionDetection } from './security/IntrusionDetection';
import { ReplayProtector } from './security/ReplayProtector';
import type { AppConfig } from '../../shared/types/config';
import type { DeviceInfo, FileEntry } from '../../shared/types/sync';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import micromatch from 'micromatch';
import { ensurePairingCode } from '../utils/validation';

interface ConnectionInfo {
  socket: ServerSocket;
  deviceId: string;
  secure: boolean;
  established: Date;
  lastActivity: Date;
  role: 'client' | 'server';
}

interface PairingRequestState {
  deviceId: string;
  deviceName: string;
  platform: string;
  timestamp: Date;
  expires: Date;
  code: string;
  publicKey: string;
}

export class NetworkManager extends EventEmitter {
  private server: HttpServer | HttpsServer | null = null;
  private socketServer: SocketIOServer | null = null;
  private readonly connections: Map<string, ConnectionInfo> = new Map();
  private readonly pairingRequests: Map<string, PairingRequestState> = new Map();
  private readonly discoveryService: DiscoveryService;
  private readonly natTraversal: NATTraversal;
  private readonly secureChannel: SecureChannel;
  private readonly peerRegistry: PeerRegistry;
  private readonly messageBus: MessageBus;
  private readonly rateLimiter = new RateLimiter(100, 60_000);
  private readonly intrusionDetection = new IntrusionDetection();
  private readonly replayProtector = new ReplayProtector();
  private readonly deviceId: string;
  private readonly DEFAULT_PORT = 45_789;
  private readonly PAIRING_TIMEOUT = 5 * 60 * 1000;
  private readonly MAX_PAIRING_ATTEMPTS = 5;
  private readonly PAIRING_ATTEMPT_WINDOW = 60 * 1000;
  private readonly pairingAttemptTracker = new Map<string, number[]>();
  private readonly MAX_DIRECTORY_DEPTH = 32;
  private readonly MAX_DIRECTORY_ENTRIES = 20000;
  private walkEntryCount = 0;
  private readonly CONNECTION_TIMEOUT = 30 * 1000;
  private readonly HEARTBEAT_INTERVAL = 10 * 1000;

  constructor(private readonly store: Store<AppConfig>) {
    super();
    this.deviceId = this.getOrCreateDeviceId();
    this.peerRegistry = new PeerRegistry();
    this.messageBus = new MessageBus();
    this.discoveryService = new DiscoveryService({
      port: 45_788,
      multicastAddress: '239.255.255.250',
      intervalMs: 5_000,
      peerRegistry: this.peerRegistry,
    });
    this.natTraversal = new NATTraversal();
    this.secureChannel = new SecureChannel(this.deviceId);

    this.discoveryService.on('peer-discovered', (announcement) => {
      this.handleDeviceDiscovered({
        id: announcement.peerId,
        name: announcement.peerId,
        address: announcement.address,
        port: announcement.port,
        status: 'discovering',
        capabilities: announcement.capabilities,
      });
      this.emit('peer-discovered', announcement);
    });

    this.messageBus.subscribe((message) => {
      this.handleMessage(message).catch((error) => this.emit('error', error));
    });

    this.rateLimiter.on('rate-limit', (peerId) => {
      this.intrusionDetection.report({ peerId, type: 'rate-limit', timestamp: Date.now() });
    });
  }

  async start(): Promise<void> {
    try {
      await this.secureChannel.initialize();

      if (this.store.get('security.encryptionEnabled')) {
        const { key, cert } = await this.secureChannel.generateCertificates();
        this.server = https.createServer({ key, cert });
      } else {
        this.server = http.createServer();
      }

      this.socketServer = new SocketIOServer(this.server, {
        cors: { origin: '*', methods: ['GET', 'POST'] },
        pingTimeout: 60_000,
        pingInterval: 25_000,
      });

      this.socketServer.on('connection', (socket) => this.handleIncomingConnection(socket));

      const port = await this.findAvailablePort();
      await new Promise<void>((resolve, reject) => {
        this.server!.once('error', reject);
        this.server!.listen(port, () => {
          logger.info(`Network server started on port ${port}`);
          resolve();
        });
      });

      await this.discoveryService.start(this.deviceId, port);
      await this.natTraversal.start();
      this.startHeartbeat();
    } catch (error) {
      logger.error('Failed to start network manager:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    for (const connection of this.connections.values()) {
      connection.socket.disconnect();
    }
    this.connections.clear();

    await this.discoveryService.stop();
    await this.natTraversal.stop();

    if (this.socketServer) {
      this.socketServer.close();
      this.socketServer = null;
    }
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  getDeviceId(): string {
    return this.deviceId;
  }

  getConnectedDevices(): Set<string> {
    return new Set(this.connections.keys());
  }

  getConnection(deviceId: string): ConnectionInfo | null {
    return this.connections.get(deviceId) ?? null;
  }

  emitTo<TPayload>(deviceId: string, channel: string, payload: TPayload): void {
    const connection = this.connections.get(deviceId);
    if (!connection) {
      logger.warn(`Attempted to emit to disconnected device ${deviceId}`);
      return;
    }
    connection.socket.emit(channel, payload);
  }

  async generatePairingCode(): Promise<{ code: string; qrCode: string }> {
    const code = crypto.randomBytes(8).toString('hex').toUpperCase();
    const request: PairingRequestState = {
      deviceId: this.deviceId,
      deviceName: os.hostname(),
      platform: process.platform,
      timestamp: new Date(),
      expires: new Date(Date.now() + this.PAIRING_TIMEOUT),
      code,
      publicKey: await this.secureChannel.getPublicKey(),
    };

    this.pairingRequests.set(code, request);
    setTimeout(() => this.pairingRequests.delete(code), this.PAIRING_TIMEOUT);

    const addressInfo = this.server?.address();
    const port =
      typeof addressInfo === 'object' && addressInfo ? addressInfo.port : this.DEFAULT_PORT;

    const payload = JSON.stringify({
      code,
      deviceId: this.deviceId,
      addresses: this.getLocalAddresses(),
      port,
    });

    const qrCode = await QRCode.toDataURL(payload);
    return { code, qrCode };
  }

  async pairDevice(code: string): Promise<DeviceInfo> {
    const sanitizedCode = ensurePairingCode(code);

    const now = Date.now();
    const attempts = this.pairingAttemptTracker.get(sanitizedCode) ?? [];
    const recentAttempts = attempts.filter(
      (timestamp) => now - timestamp < this.PAIRING_ATTEMPT_WINDOW
    );

    if (recentAttempts.length >= this.MAX_PAIRING_ATTEMPTS) {
      throw new Error('Too many pairing attempts. Please wait and try again.');
    }

    recentAttempts.push(now);
    this.pairingAttemptTracker.set(sanitizedCode, recentAttempts);
    setTimeout(() => this.pairingAttemptTracker.delete(sanitizedCode), this.PAIRING_ATTEMPT_WINDOW);

    const discovered = await this.discoveryService.scan(5_000);

    for (const peer of discovered) {
      try {
        const socket = SocketIOClient(`http://${peer.address}:${peer.port}`, { timeout: 5_000 });

        const device = await new Promise<DeviceInfo>((resolve, reject) => {
          socket.on('connect', () => {
            socket.emit('pairing-request', { code: sanitizedCode });
            socket.on('pairing-response', async (response: any) => {
              if (response.success) {
                const newDevice: DeviceInfo = {
                  id: response.deviceId,
                  name: response.deviceName,
                  platform: response.platform,
                  status: 'online',
                  address: peer.address,
                  port: peer.port,
                  pairedAt: new Date(),
                  capabilities: response.capabilities,
                  publicKey: response.publicKey,
                } as DeviceInfo;

                const devices = this.store.get('devices');
                devices.push(newDevice);
                this.store.set('devices', devices);
                socket.disconnect();
                resolve(newDevice);
              } else {
                socket.disconnect();
                reject(new Error(response.error ?? 'Invalid pairing code'));
              }
            });
          });

          socket.on('connect_error', () => reject(new Error('Failed to connect')));
        });

        await this.connectToDevice(device.id, peer.address, peer.port);
        return device;
      } catch (error) {
        logger.debug('Pairing attempt failed:', error);
      }
    }

    throw new Error('No device found with this pairing code');
  }

  async requestFileList(deviceId: string, folderId: string): Promise<any[]> {
    const connection = this.connections.get(deviceId);
    if (!connection) {
      throw new Error(`Not connected to device ${deviceId}`);
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('File list request timeout')), 30_000);

      connection.socket.emit('request-file-list', { folderId });
      connection.socket.once('file-list-response', (data) => {
        clearTimeout(timeout);
        resolve(data.files);
      });
      connection.socket.once('file-list-error', (error) => {
        clearTimeout(timeout);
        reject(new Error(error.error ?? 'File list error'));
      });
    });
  }

  async getLocalFileList(folderId: string): Promise<FileEntry[]> {
    const folder = this.store.get('folders').find((f) => f.id === folderId);
    if (!folder) {
      throw new Error(`Folder ${folderId} not found`);
    }

    this.walkEntryCount = 0;
    return this.walkDirectory(folder.path, folder.ignorePatterns, 0, folder.path);
  }

  send(message: ProtocolMessage): void {
    this.messageBus.send(message);
  }

  private getOrCreateDeviceId(): string {
    const existing = this.store.get('deviceId');
    if (typeof existing === 'string' && existing.length > 0) {
      return existing;
    }

    const generated = uuidv4();
    this.store.set('deviceId', generated);
    return generated;
  }

  private async handleMessage(message: ProtocolMessage): Promise<void> {
    if (!this.rateLimiter.check(message.peerId)) {
      return;
    }

    if ('nonce' in message && typeof (message as any).timestamp === 'number') {
      if (this.replayProtector.isReplay(message.nonce, (message as any).timestamp)) {
        this.intrusionDetection.report({
          peerId: message.peerId,
          type: 'replay',
          timestamp: Date.now(),
        });
        return;
      }
    }

    switch (message.type) {
      case 'discovery-announcement':
        this.peerRegistry.upsert({
          id: message.peerId,
          name: message.peerId,
          address: message.address,
          port: message.port,
          status: 'discovering',
          capabilities: message.capabilities,
        });
        break;
      case 'pairing-request':
        this.emit('pairing-request', message);
        break;
      case 'pairing-response':
        this.emit('pairing-response', message);
        break;
      case 'sync-message':
        this.emit('sync-message', message);
        break;
      default:
        break;
    }
  }

  private async findAvailablePort(startPort = this.DEFAULT_PORT): Promise<number> {
    let port = startPort;
    while (!(await this.isPortAvailable(port))) {
      port += 1;
    }
    return port;
  }

  private isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = http.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close();
        resolve(true);
      });
      server.listen(port);
    });
  }

  private handleIncomingConnection(socket: ServerSocket): void {
    const address = (socket.handshake.address as string) ?? 'unknown';
    logger.info(`New connection from ${address}`);
    const authTimeout = setTimeout(() => {
      const authenticated = Boolean((socket.data as Record<string, unknown>)?.authenticated);
      if (!authenticated) {
        socket.disconnect();
        logger.warn('Connection closed due to authentication timeout');
      }
    }, this.CONNECTION_TIMEOUT);

    socket.on('authenticate', async (data) => {
      clearTimeout(authTimeout);
      try {
        if (await this.authenticateDevice(data)) {
          (socket.data as Record<string, unknown>).authenticated = true;
          (socket.data as Record<string, unknown>).deviceId = data.deviceId;

          this.connections.set(data.deviceId, {
            socket,
            deviceId: data.deviceId,
            secure: this.store.get('security.encryptionEnabled'),
            established: new Date(),
            lastActivity: new Date(),
            role: 'server',
          });

          socket.emit('authenticated', { deviceId: this.deviceId });
          this.emit('device-connected', data.deviceId);
          this.setupDeviceHandlers(socket, data.deviceId);
        } else {
          socket.emit('authentication-failed');
          socket.disconnect();
        }
      } catch (error) {
        logger.error('Authentication error:', error);
        socket.disconnect();
      }
    });

    socket.on('pairing-request', async (payload) => {
      await this.handlePairingRequest(socket, payload);
    });
  }

  private async authenticateDevice(data: any): Promise<boolean> {
    if (!data?.deviceId) {
      return false;
    }

    const devices = this.store.get('devices');
    const device = devices.find((d) => d.id === data.deviceId);
    if (!device) {
      return false;
    }

    if (this.store.get('security.encryptionEnabled')) {
      if (!device.publicKey || !data.challenge || !data.signature) {
        return false;
      }
      return this.secureChannel.verifySignature(data.challenge, data.signature, device.publicKey);
    }

    return true;
  }

  private setupDeviceHandlers(socket: ServerSocket, deviceId: string): void {
    socket.on('request-file-list', async (data) => {
      try {
        const files = await this.getLocalFileList(data.folderId);
        socket.emit('file-list-response', { folderId: data.folderId, files });
      } catch (error) {
        logger.error('Failed to get local file list:', error);
        socket.emit('file-list-error', { error: (error as Error).message });
      }
    });

    socket.on('request-file', (data: TransferRequestMessage) => {
      this.emit('transfer-request', { deviceId, payload: data });
    });

    socket.on('transfer-init', (data: TransferInitMessage) => {
      this.emit('transfer-init', { deviceId, payload: data });
    });

    socket.on('transfer-chunk', (data: TransferChunkMessage) => {
      this.emit('transfer-chunk', { deviceId, payload: data });
    });

    socket.on('transfer-complete', (data: TransferCompleteMessage) => {
      this.emit('transfer-complete', { deviceId, payload: data });
    });

    socket.on('transfer-error', (data: TransferErrorMessage) => {
      this.emit('transfer-error', { deviceId, payload: data });
    });

    socket.on('sync-status', (data) => {
      this.emit('remote-sync-status', { deviceId, ...data });
    });

    socket.on('disconnect', () => {
      this.connections.delete(deviceId);
      this.emit('device-disconnected', deviceId);
      logger.info(`Device ${deviceId} disconnected`);
    });
  }

  private async connectToDevice(deviceId: string, address: string, port: number): Promise<void> {
    if (this.connections.has(deviceId)) {
      logger.info(`Already connected to device ${deviceId}`);
      return;
    }

    const socket = SocketIOClient(`http://${address}:${port}`, {
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1_000,
      timeout: this.CONNECTION_TIMEOUT,
    }) as unknown as ServerSocket;

    socket.on('connect', async () => {
      logger.info(`Connected to device ${deviceId} at ${address}:${port}`);
      const authData: any = { deviceId: this.deviceId };

      (socket as unknown as ClientSocket).emit('authenticate', authData);
    });

    socket.on('authenticated', () => {
      this.connections.set(deviceId, {
        socket,
        deviceId,
        secure: this.store.get('security.encryptionEnabled'),
        established: new Date(),
        lastActivity: new Date(),
        role: 'client',
      });
      this.emit('device-connected', deviceId);
      this.setupDeviceHandlers(socket, deviceId);
    });

    socket.on('authentication-failed', () => {
      logger.error(`Authentication failed for device ${deviceId}`);
      socket.disconnect();
    });

    socket.on('connect_error', (error) => {
      logger.error(`Failed to connect to device ${deviceId}:`, error);
    });
  }

  private async handlePairingRequest(socket: ServerSocket, data: any): Promise<void> {
    const request = this.pairingRequests.get(data.code);
    if (!request || request.expires < new Date()) {
      socket.emit('pairing-response', { success: false, error: 'Invalid or expired code' });
      return;
    }

    const response = {
      success: true,
      deviceId: this.deviceId,
      deviceName: os.hostname(),
      platform: process.platform,
      publicKey: await this.secureChannel.getPublicKey(),
      capabilities: {
        maxConnections: 10,
        compressionEnabled: true,
        relayEnabled: true,
        natTraversalEnabled: true,
        protocolVersion: '1.0.0',
      },
    };

    socket.emit('pairing-response', response);
    this.pairingRequests.delete(data.code);
  }

  private async walkDirectory(
    targetPath: string,
    ignorePatterns: string[],
    depth: number,
    basePath: string
  ): Promise<FileEntry[]> {
    if (depth > this.MAX_DIRECTORY_DEPTH) {
      throw new Error(`Directory depth exceeds supported limit (${this.MAX_DIRECTORY_DEPTH}).`);
    }

    const entries: FileEntry[] = [];
    const dirEntries = await fs.readdir(targetPath, { withFileTypes: true });

    for (const entry of dirEntries) {
      this.walkEntryCount += 1;
      if (this.walkEntryCount > this.MAX_DIRECTORY_ENTRIES) {
        throw new Error('Directory contains too many entries to index safely.');
      }
      const fullPath = path.join(targetPath, entry.name);
      const relativePath = path.relative(basePath, fullPath) || entry.name;
      if (entry.isSymbolicLink()) {
        continue;
      }

      const shouldIgnore = DEFAULT_IGNORE_PATTERNS.concat(ignorePatterns).some((pattern) =>
        micromatch.isMatch(relativePath, pattern, { dot: true })
      );

      if (shouldIgnore) {
        continue;
      }

      if (entry.isDirectory()) {
        const stats = await fs.stat(fullPath);
        const children = await this.walkDirectory(fullPath, ignorePatterns, depth + 1, basePath);
        entries.push({
          name: entry.name,
          path: fullPath,
          type: 'directory',
          size: children.reduce((acc, child) => acc + child.size, 0),
          modifiedAt: stats.mtime.toISOString(),
          children,
        });
      } else if (entry.isFile()) {
        const stats = await fs.stat(fullPath);
        entries.push({
          name: entry.name,
          path: fullPath,
          type: 'file',
          size: stats.size,
          modifiedAt: stats.mtime.toISOString(),
          hash: await this.hashFile(fullPath),
        });
      }
    }

    return entries;
  }

  private async hashFile(filePath: string): Promise<string> {
    const hash = crypto.createHash('sha256');
    const data = await fs.readFile(filePath);
    hash.update(data);
    return hash.digest('hex');
  }

  private handleDeviceDiscovered(device: PeerInfo): void {
    const devices = this.store.get('devices');
    const knownDevice = devices.find((d) => d.id === device.id);

    if (knownDevice && !this.connections.has(device.id) && device.address && device.port) {
      void this.connectToDevice(device.id, device.address, device.port);
    }
  }

  private startHeartbeat(): void {
    setInterval(() => {
      const now = Date.now();
      for (const [deviceId, connection] of this.connections) {
        const idle = now - connection.lastActivity.getTime();
        if (idle > this.HEARTBEAT_INTERVAL * 3) {
          logger.warn(`Connection to ${deviceId} appears stale; disconnecting`);
          connection.socket.disconnect();
          this.connections.delete(deviceId);
          this.emit('device-disconnected', deviceId);
        } else {
          connection.socket.emit('heartbeat');
          connection.socket.once('heartbeat-ack', () => {
            connection.lastActivity = new Date();
          });
        }
      }
    }, this.HEARTBEAT_INTERVAL);
  }

  private getLocalAddresses(): string[] {
    const interfaces = os.networkInterfaces();
    const addresses: string[] = [];
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] ?? []) {
        if (iface.family === 'IPv4' && !iface.internal && iface.address) {
          addresses.push(iface.address);
        }
      }
    }
    return addresses;
  }
}
