import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import Store from 'electron-store';
import { AppConfig } from '../../shared/types/config';
import { SecureChannel } from './secureChannel';
import { PairingRequest, PairingResponse } from './protocol/Protocol';
import { MessageBus } from './MessageBus';
import { RateLimiter } from './security/RateLimiter';

interface PairingServiceOptions {
  secureChannel: SecureChannel;
  messageBus: MessageBus;
  store: Store<AppConfig>;
}

export class PairingService extends EventEmitter {
  private readonly pendingCodes = new Map<string, string>();
  private readonly peerId: string;
  private readonly pairingRateLimiter: RateLimiter;
  private readonly failedAttempts = new Map<string, number>();
  private readonly MAX_FAILED_ATTEMPTS = 5;
  private readonly LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes

  constructor(private readonly options: PairingServiceOptions) {
    super();
    this.peerId = crypto.randomBytes(16).toString('hex');
    this.pairingRateLimiter = new RateLimiter({
      points: 10,
      duration: 60,
      blockDuration: 300,
    });

    this.options.messageBus.subscribe((message) => {
      if (message.type === 'pairing-request') {
        this.emit('pairing-request', message);
      } else if (message.type === 'pairing-response') {
        this.emit('pairing-response', message);
      }
    });
  }

  generateCode(): string {
    const code = crypto.randomInt(100000, 999999).toString().padStart(6, '0');
    this.pendingCodes.set(code, this.peerId);
    return code;
  }

  async createRequest(code: string): Promise<PairingRequest> {
    return {
      type: 'pairing-request',
      peerId: this.peerId,
      code,
      publicKey: await this.options.secureChannel.getPublicKey(),
      nonce: crypto.randomBytes(16).toString('hex'), // ✅ SECURITY FIX: crypto-secure nonce
    };
  }

  async handleResponse(response: PairingResponse): Promise<boolean> {
    if (!response.accepted || !response.publicKey) {
      return false;
    }

    const devices = this.options.store.get('devices');
    const existing = devices.find((device) => device.id === response.peerId);

    if (existing) {
      existing.publicKey = response.publicKey;
    } else {
      devices.push({
        id: response.peerId,
        name: response.peerId,
        platform: 'unknown',
        status: 'offline',
        pairedAt: new Date(),
        capabilities: {
          maxConnections: 10,
          compressionEnabled: true,
          relayEnabled: true,
          natTraversalEnabled: true,
          protocolVersion: '1.0.0',
        },
        publicKey: response.publicKey,
      } as any);
    }

    this.options.store.set('devices', devices);
    return true;
  }

  async acceptRequest(request: PairingRequest): Promise<PairingResponse> {
    // Rate limit check
    const rateLimitResult = await this.pairingRateLimiter.consume(request.peerId);
    if (!rateLimitResult.success) {
      throw new Error(
        `Rate limit exceeded. Try again in ${Math.ceil(rateLimitResult.msBeforeNext! / 1000)}s`
      );
    }

    // Check lockout
    const failCount = this.failedAttempts.get(request.peerId) || 0;
    if (failCount >= this.MAX_FAILED_ATTEMPTS) {
      throw new Error(
        `Too many failed attempts. Account locked for ${this.LOCKOUT_DURATION / 60000} minutes`
      );
    }

    const expectedPeer = this.pendingCodes.get(request.code);
    const accepted = expectedPeer === this.peerId;

    if (accepted) {
      await this.persistTrustedKey(request.peerId, request.publicKey);
      this.failedAttempts.delete(request.peerId);
    } else {
      this.failedAttempts.set(request.peerId, failCount + 1);
      // Auto-reset after lockout duration
      setTimeout(() => {
        this.failedAttempts.delete(request.peerId);
      }, this.LOCKOUT_DURATION);
    }

    return {
      type: 'pairing-response',
      peerId: this.peerId,
      accepted,
      publicKey: accepted ? await this.options.secureChannel.getPublicKey() : undefined,
    };
  }

  private async persistTrustedKey(deviceId: string, publicKey: string): Promise<void> {
    const devices = this.options.store.get('devices');
    const existing = devices.find((device) => device.id === deviceId);

    if (existing) {
      existing.publicKey = publicKey;
    } else {
      devices.push({
        id: deviceId,
        name: deviceId,
        platform: 'unknown',
        status: 'offline',
        pairedAt: new Date(),
        capabilities: {
          maxConnections: 10,
          compressionEnabled: true,
          relayEnabled: true,
          natTraversalEnabled: true,
          protocolVersion: '1.0.0',
        },
        publicKey,
      } as any);
    }

    this.options.store.set('devices', devices);
  }
}
