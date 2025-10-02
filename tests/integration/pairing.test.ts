import { describe, it, expect, jest } from '@jest/globals';
import type Store from 'electron-store';

import { PairingService } from '../../src/main/network/PairingService';
import { MessageBus } from '../../src/main/network/MessageBus';
import type { SecureChannel } from '../../src/main/network/secureChannel';
import type { AppConfig } from '../../src/shared/types/config';

jest.mock('../../src/main/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('PairingService', () => {
  const createStoreMock = () => {
    const devices: AppConfig['devices'] = [];

    const mockStore = {
      get: jest.fn((key: keyof AppConfig) => {
        if (key === 'devices') {
          return devices;
        }
        return undefined;
      }),
      set: jest.fn((key: keyof AppConfig, value: AppConfig['devices']) => {
        if (key === 'devices') {
          devices.splice(0, devices.length, ...value);
        }
      }),
    } as unknown as Store<AppConfig>;

    return { mockStore, devices };
  };

  const createChannelMock = () => {
    const channel = {
      getPublicKey: jest.fn(async () => 'public-key-1'),
    };

    return channel as unknown as SecureChannel;
  };

  it('accepts a valid pairing code and persists device keys', async () => {
    const { mockStore, devices } = createStoreMock();
    const mockChannel = createChannelMock();

    const bus = new MessageBus();
    const service = new PairingService({
      secureChannel: mockChannel,
      messageBus: bus,
      store: mockStore,
    });

    const code = service.generateCode();
    const response = await service.acceptRequest({
      type: 'pairing-request',
      peerId: 'peer-2',
      code,
      publicKey: 'key-123',
      nonce: 'nonce-abc',
    });

    expect(response.accepted).toBe(true);
    expect(mockChannel.getPublicKey).toHaveBeenCalledTimes(1);
    expect(mockStore.set).toHaveBeenCalledWith('devices', expect.any(Array));
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({ id: 'peer-2', publicKey: 'key-123' });
  });

  it('rejects invalid pairing codes without mutating store', async () => {
    const { mockStore, devices } = createStoreMock();
    const mockChannel = createChannelMock();

    const bus = new MessageBus();
    const service = new PairingService({
      secureChannel: mockChannel,
      messageBus: bus,
      store: mockStore,
    });

    service.generateCode();
    const response = await service.acceptRequest({
      type: 'pairing-request',
      peerId: 'peer-3',
      code: 'WRONG',
      publicKey: 'key-987',
      nonce: 'nonce-xyz',
    });

    expect(response.accepted).toBe(false);
    expect(mockChannel.getPublicKey).not.toHaveBeenCalled();
    expect(mockStore.set).not.toHaveBeenCalled();
    expect(devices).toHaveLength(0);
  });

  it('creates a pairing request with public key and nonce', async () => {
    const { mockStore } = createStoreMock();
    const mockChannel = createChannelMock();

    // ✅ FIX: Mock crypto.randomBytes instead of Math.random (16 bytes = 32 hex chars)
    const crypto = require('crypto');
    const mockBuffer = Buffer.from('0123456789ABCDEF0123456789ABCDEF', 'hex');
    const cryptoSpy = jest.spyOn(crypto, 'randomBytes').mockReturnValue(mockBuffer);
    const expectedNonce = mockBuffer.toString('hex');

    const bus = new MessageBus();
    const service = new PairingService({
      secureChannel: mockChannel,
      messageBus: bus,
      store: mockStore,
    });

    const request = await service.createRequest('CODE123');

    expect(request.type).toBe('pairing-request');
    expect(request.peerId).toMatch(/^[0-9a-f]{32}$/); // 32 hex chars
    expect(request.code).toBe('CODE123');
    expect(request.publicKey).toBe('public-key-1');
    expect(request.nonce).toBe(expectedNonce);

    expect(mockChannel.getPublicKey).toHaveBeenCalledTimes(1);
    cryptoSpy.mockRestore();
  });

  it('handles pairing response by adding a new device', async () => {
    const { mockStore, devices } = createStoreMock();
    const mockChannel = createChannelMock();

    const bus = new MessageBus();
    const service = new PairingService({
      secureChannel: mockChannel,
      messageBus: bus,
      store: mockStore,
    });

    const result = await service.handleResponse({
      type: 'pairing-response',
      peerId: 'peer-9',
      accepted: true,
      publicKey: 'peer-9-key',
    });

    expect(result).toBe(true);
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({ id: 'peer-9', publicKey: 'peer-9-key' });
    expect(mockStore.set).toHaveBeenCalledTimes(1);
    expect(mockStore.set).toHaveBeenCalledWith('devices', devices);
  });

  it('updates existing device on pairing response', async () => {
    const { mockStore, devices } = createStoreMock();
    devices.push({
      id: 'peer-existing',
      name: 'peer-existing',
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
      publicKey: 'old-key',
    } as any);

    const mockChannel = createChannelMock();
    const bus = new MessageBus();
    const service = new PairingService({
      secureChannel: mockChannel,
      messageBus: bus,
      store: mockStore,
    });

    const result = await service.handleResponse({
      type: 'pairing-response',
      peerId: 'peer-existing',
      accepted: true,
      publicKey: 'new-key',
    });

    expect(result).toBe(true);
    expect(devices).toHaveLength(1);
    expect(devices[0].publicKey).toBe('new-key');
    expect(mockStore.set).toHaveBeenCalledTimes(1);
    expect(mockStore.set).toHaveBeenCalledWith('devices', devices);
  });

  it('ignores rejected pairing response', async () => {
    const { mockStore, devices } = createStoreMock();
    const mockChannel = createChannelMock();

    const bus = new MessageBus();
    const service = new PairingService({
      secureChannel: mockChannel,
      messageBus: bus,
      store: mockStore,
    });

    const result = await service.handleResponse({
      type: 'pairing-response',
      peerId: 'peer-ignored',
      accepted: false,
    });

    expect(result).toBe(false);
    expect(devices).toHaveLength(0);
    expect(mockStore.set).not.toHaveBeenCalled();
  });

  it('rejects accepted response missing public key', async () => {
    const { mockStore, devices } = createStoreMock();
    const mockChannel = createChannelMock();

    const bus = new MessageBus();
    const service = new PairingService({
      secureChannel: mockChannel,
      messageBus: bus,
      store: mockStore,
    });

    const result = await service.handleResponse({
      type: 'pairing-response',
      peerId: 'peer-no-key',
      accepted: true,
    });

    expect(result).toBe(false);
    expect(devices).toHaveLength(0);
    expect(mockStore.set).not.toHaveBeenCalled();
  });
});
