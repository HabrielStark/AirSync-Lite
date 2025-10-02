import { EventEmitter } from 'events';
import dgram, { RemoteInfo } from 'dgram';
import os from 'os';
import { logger } from '../utils/logger';
import { DiscoveryAnnouncement } from './protocol/Protocol';
import { PeerRegistry } from './PeerRegistry';

interface DiscoveryServiceOptions {
  port: number;
  multicastAddress: string;
  intervalMs: number;
  peerRegistry: PeerRegistry;
}

interface DiscoveredDevice {
  id: string;
  name: string;
  address: string;
  port: number;
  capabilities?: Record<string, unknown>;
  lastSeenAt: number;
}

export class DiscoveryService extends EventEmitter {
  private socket: dgram.Socket | null = null;
  private broadcastInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly discoveredDevices = new Map<string, DiscoveredDevice>();

  constructor(private readonly options: DiscoveryServiceOptions) {
    super();
  }

  async start(deviceId: string, servicePort: number): Promise<void> {
    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    await new Promise<void>((resolve, reject) => {
      this.socket!.once('error', reject);
      this.socket!.bind(this.options.port, () => {
        this.socket!.removeListener('error', reject);
        resolve();
      });
    });

    this.socket.setBroadcast(true);
    this.socket.setMulticastTTL(128);
    this.socket.addMembership(this.options.multicastAddress);
    this.socket.on('message', (msg, rinfo) => this.handleMessage(deviceId, msg, rinfo));

    this.startBroadcasting(deviceId, servicePort);
    this.cleanupInterval = setInterval(() => this.cleanupDevices(), this.options.intervalMs * 2);
    logger.info('Discovery service started');
  }

  async stop(): Promise<void> {
    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
      this.broadcastInterval = null;
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    if (this.socket) {
      await new Promise<void>((resolve) => this.socket!.close(() => resolve()));
      this.socket = null;
    }

    this.discoveredDevices.clear();
    logger.info('Discovery service stopped');
  }

  async scan(timeoutMs: number): Promise<DiscoveredDevice[]> {
    await new Promise((resolve) => setTimeout(resolve, timeoutMs));
    return [...this.discoveredDevices.values()];
  }

  private startBroadcasting(deviceId: string, servicePort: number): void {
    const broadcast = () => {
      if (!this.socket) {
        return;
      }

      const message: DiscoveryAnnouncement = {
        type: 'discovery-announcement',
        peerId: deviceId,
        address: '',
        port: servicePort,
        capabilities: { version: '1.0.0' },
        timestamp: Date.now(),
      };

      const payload = Buffer.from(JSON.stringify(message));
      this.socket.send(payload, this.options.port, this.options.multicastAddress, (err) => {
        if (err) {
          logger.debug('Multicast broadcast error:', err);
        }
      });

      const interfaces = os.networkInterfaces();
      for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name] ?? []) {
          if (iface.family === 'IPv4' && !iface.internal && iface.address && iface.netmask) {
            const broadcastAddress = this.calculateBroadcastAddress(iface.address, iface.netmask);
            this.socket!.send(payload, this.options.port, broadcastAddress, (err) => {
              if (err) {
                logger.debug(`Broadcast error on ${name}:`, err);
              }
            });
          }
        }
      }
    };

    broadcast();
    this.broadcastInterval = setInterval(broadcast, this.options.intervalMs);
  }

  private handleMessage(selfId: string, msg: Buffer, rinfo: RemoteInfo): void {
    try {
      const announcement = JSON.parse(msg.toString()) as DiscoveryAnnouncement;
      if (announcement.type !== 'discovery-announcement' || announcement.peerId === selfId) {
        return;
      }

      const device: DiscoveredDevice = {
        id: announcement.peerId,
        name: announcement.peerId,
        address: rinfo.address,
        port: announcement.port,
        capabilities: announcement.capabilities,
        lastSeenAt: Date.now(),
      };

      this.discoveredDevices.set(device.id, device);
      this.options.peerRegistry.upsert({
        id: device.id,
        name: device.name,
        address: device.address,
        port: device.port,
        status: 'discovering',
        capabilities: device.capabilities,
      });

      this.emit('peer-discovered', announcement);
    } catch (error) {
      logger.error('Failed to parse discovery message:', error);
      this.emit('error', error);
    }
  }

  private cleanupDevices(): void {
    const now = Date.now();
    for (const [id, device] of this.discoveredDevices) {
      if (now - device.lastSeenAt > this.options.intervalMs * 6) {
        this.discoveredDevices.delete(id);
        this.options.peerRegistry.remove(id);
        this.emit('peer-removed', id);
      }
    }
  }

  private calculateBroadcastAddress(address: string, netmask: string): string {
    const addrParts = address.split('.').map((part) => Number.parseInt(part, 10));
    const maskParts = netmask.split('.').map((part) => Number.parseInt(part, 10));
    const broadcastParts = addrParts.map((part, index) => part | (~maskParts[index] & 0xff));
    return broadcastParts.join('.');
  }
}
