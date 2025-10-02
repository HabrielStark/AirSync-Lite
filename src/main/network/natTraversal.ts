import { EventEmitter } from 'events';
import * as dgram from 'dgram';
import * as net from 'net';
import * as crypto from 'crypto';
import { logger } from '../utils/logger';

interface STUNResult {
  address: string;
  port: number;
  type: 'open' | 'symmetric' | 'restricted' | 'port-restricted';
}

interface RelayServer {
  address: string;
  port: number;
  token: string;
}

export class NATTraversal extends EventEmitter {
  private stunServers = [
    { host: 'stun.l.google.com', port: 19302 },
    { host: 'stun1.l.google.com', port: 19302 },
    { host: 'stun2.l.google.com', port: 19302 },
    { host: 'stun3.l.google.com', port: 19302 },
    { host: 'stun4.l.google.com', port: 19302 },
  ];

  private relayServers: RelayServer[] = [];
  private publicEndpoint: STUNResult | null = null;
  private udpSocket: dgram.Socket | null = null;
  private tcpPunchSocket: net.Socket | null = null;

  constructor() {
    super();
  }

  async start(): Promise<void> {
    try {
      // Discover public endpoint using STUN
      this.publicEndpoint = await this.discoverPublicEndpoint();
      logger.info(
        `NAT type: ${this.publicEndpoint.type}, Public endpoint: ${this.publicEndpoint.address}:${this.publicEndpoint.port}`
      );

      // Set up UDP hole punching socket
      this.udpSocket = dgram.createSocket('udp4');
      this.udpSocket.on('message', (msg, rinfo) => {
        this.handleUDPMessage(msg, rinfo);
      });

      // Bind to discovered port if possible
      await new Promise<void>((resolve, reject) => {
        this.udpSocket!.once('error', reject);
        this.udpSocket!.bind(this.publicEndpoint!.port, () => {
          this.udpSocket!.removeListener('error', reject);
          resolve();
        });
      });

      logger.info('NAT traversal service started');
    } catch (error) {
      logger.error('Failed to start NAT traversal:', error);
      // Continue without NAT traversal
    }
  }

  private async discoverPublicEndpoint(): Promise<STUNResult> {
    for (const server of this.stunServers) {
      try {
        const socket = dgram.createSocket('udp4');
        const result = await this.performSTUNQuery(socket, server);
        socket.close();

        return {
          address: result.address,
          port: result.port,
          type: await this.detectNATType(server),
        };
      } catch (error) {
        logger.debug(`STUN server ${server.host} failed:`, error);
        continue;
      }
    }

    throw new Error('All STUN servers failed');
  }

  private performSTUNQuery(
    socket: dgram.Socket,
    server: { host: string; port: number }
  ): Promise<{ address: string; port: number }> {
    return new Promise((resolve, reject) => {
      const transactionId = crypto.randomBytes(12);

      // Create STUN binding request (simplified)
      const stunRequest = Buffer.concat([
        Buffer.from([0x00, 0x01]), // Binding Request
        Buffer.from([0x00, 0x00]), // Message Length (no attributes)
        Buffer.from([0x21, 0x12, 0xa4, 0x42]), // Magic Cookie
        transactionId,
      ]);

      const timeout = setTimeout(() => {
        reject(new Error('STUN query timeout'));
      }, 5000);

      socket.once('message', (msg) => {
        clearTimeout(timeout);

        try {
          // Parse STUN response (simplified)
          if (msg.length < 20) {
            reject(new Error('Invalid STUN response'));
            return;
          }

          // Extract XOR-MAPPED-ADDRESS (simplified parsing)
          let offset = 20;
          while (offset < msg.length) {
            const attrType = msg.readUInt16BE(offset);
            const attrLength = msg.readUInt16BE(offset + 2);

            if (attrType === 0x0020) {
              // XOR-MAPPED-ADDRESS
              const family = msg[offset + 5];
              const port = msg.readUInt16BE(offset + 6) ^ 0x2112;
              const addr =
                family === 0x01
                  ? `${msg[offset + 8] ^ 0x21}.${msg[offset + 9] ^ 0x12}.${msg[offset + 10] ^ 0xa4}.${msg[offset + 11] ^ 0x42}`
                  : ''; // IPv6 not implemented

              resolve({ address: addr, port });
              return;
            }

            offset += 4 + attrLength;
            // Align to 4-byte boundary
            offset = Math.ceil(offset / 4) * 4;
          }

          reject(new Error('No XOR-MAPPED-ADDRESS in response'));
        } catch (error) {
          reject(error);
        }
      });

      socket.send(stunRequest, server.port, server.host, (err) => {
        if (err) {
          clearTimeout(timeout);
          reject(err);
        }
      });
    });
  }

  private async detectNATType(stunServer: {
    host: string;
    port: number;
  }): Promise<STUNResult['type']> {
    // Simplified NAT type detection
    // In a real implementation, this would perform multiple STUN queries
    // to determine the exact NAT type
    try {
      const socket1 = dgram.createSocket('udp4');
      const socket2 = dgram.createSocket('udp4');

      // Bind to different local ports
      await new Promise<void>((resolve) => {
        socket1.bind(0, () => resolve());
      });

      await new Promise<void>((resolve) => {
        socket2.bind(0, () => resolve());
      });

      // Query STUN from both sockets
      const res1 = await this.performSTUNQuery(socket1, stunServer);
      const res2 = await this.performSTUNQuery(socket2, stunServer);

      socket1.close();
      socket2.close();

      // Compare results
      if (res1.port === res2.port) {
        return 'symmetric';
      } else {
        return 'port-restricted';
      }
    } catch (error) {
      return 'restricted';
    }
  }

  async establishConnection(
    remoteId: string,
    remoteEndpoint: { address: string; port: number }
  ): Promise<void> {
    logger.info(
      `Attempting NAT traversal to ${remoteId} at ${remoteEndpoint.address}:${remoteEndpoint.port}`
    );

    // Try UDP hole punching
    if (await this.tryUDPHolePunch(remoteId, remoteEndpoint)) {
      return;
    }

    // Try TCP hole punching
    if (await this.tryTCPHolePunch(remoteId, remoteEndpoint)) {
      return;
    }

    // Fall back to relay
    await this.establishRelayConnection(remoteId);
  }

  private async tryUDPHolePunch(
    remoteId: string,
    remoteEndpoint: { address: string; port: number }
  ): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.udpSocket) {
        resolve(false);
        return;
      }

      const attempts = 10;
      let attempt = 0;
      let established = false;

      // Set up message handler
      const messageHandler = (msg: Buffer, rinfo: dgram.RemoteInfo) => {
        if (rinfo.address === remoteEndpoint.address) {
          const message = msg.toString();
          if (message.startsWith('AIRSYNC-PUNCH:')) {
            established = true;
            clearInterval(punchInterval);

            // Send acknowledgment
            this.udpSocket!.send(
              Buffer.from(`AIRSYNC-ACK:${remoteId}`),
              remoteEndpoint.port,
              remoteEndpoint.address
            );

            this.emit('connection-established', {
              type: 'udp',
              remoteId,
              socket: this.udpSocket,
              remoteEndpoint,
            });

            resolve(true);
          }
        }
      };

      this.udpSocket.on('message', messageHandler);

      // Send punch packets
      const punchInterval = setInterval(() => {
        if (attempt++ >= attempts || established) {
          clearInterval(punchInterval);
          this.udpSocket?.removeListener('message', messageHandler);
          if (!established) {
            resolve(false);
          }
          return;
        }

        this.udpSocket!.send(
          Buffer.from(`AIRSYNC-PUNCH:${remoteId}`),
          remoteEndpoint.port,
          remoteEndpoint.address,
          (err) => {
            if (err) {
              logger.debug('UDP punch error:', err);
            }
          }
        );
      }, 500);
    });
  }

  private async tryTCPHolePunch(
    remoteId: string,
    remoteEndpoint: { address: string; port: number }
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      let established = false;

      // Set timeout
      const timeout = setTimeout(() => {
        if (!established) {
          socket.destroy();
          resolve(false);
        }
      }, 10000);

      socket.on('connect', () => {
        established = true;
        clearTimeout(timeout);

        // Send handshake
        socket.write(`AIRSYNC-TCP:${remoteId}\n`);

        this.emit('connection-established', {
          type: 'tcp',
          remoteId,
          socket,
          remoteEndpoint,
        });

        resolve(true);
      });

      socket.on('error', (err) => {
        logger.debug('TCP punch error:', err);
        clearTimeout(timeout);
        resolve(false);
      });

      // Attempt connection
      socket.connect(remoteEndpoint.port, remoteEndpoint.address);
    });
  }

  private async establishRelayConnection(remoteId: string): Promise<void> {
    // In a production system, this would connect through a relay server
    // For now, we'll emit an event indicating relay is needed
    logger.info(`Relay connection needed for ${remoteId}`);

    this.emit('relay-needed', { remoteId });

    // Try to use a relay server if available
    if (this.relayServers.length > 0) {
      const relay = this.relayServers[0];

      const socket = new net.Socket();

      socket.on('connect', () => {
        // Authenticate with relay
        socket.write(
          JSON.stringify({
            type: 'relay-connect',
            token: relay.token,
            targetId: remoteId,
          })
        );

        this.emit('connection-established', {
          type: 'relay',
          remoteId,
          socket,
          relay,
        });
      });

      socket.connect(relay.port, relay.address);
    }
  }

  private handleUDPMessage(msg: Buffer, rinfo: dgram.RemoteInfo): void {
    const message = msg.toString();

    if (message.startsWith('AIRSYNC-')) {
      logger.debug(`Received NAT traversal message from ${rinfo.address}:${rinfo.port}`);
      // Message handling is done in tryUDPHolePunch
    }
  }

  getPublicEndpoint(): STUNResult | null {
    return this.publicEndpoint;
  }

  async stop(): Promise<void> {
    if (this.udpSocket) {
      this.udpSocket.close();
      this.udpSocket = null;
    }

    if (this.tcpPunchSocket) {
      this.tcpPunchSocket.destroy();
      this.tcpPunchSocket = null;
    }

    logger.info('NAT traversal service stopped');
  }
}
