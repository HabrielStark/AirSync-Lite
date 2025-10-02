import { EventEmitter } from 'events';
import { logger } from '../utils/logger';

interface NATPortMapping {
  protocol: 'tcp' | 'udp';
  privatePort: number;
  publicPort: number;
  ttl: number;
}

interface NATDevice {
  gateway: string;
  type: 'upnp' | 'nat-pmp';
}

export class NATManager extends EventEmitter {
  private mappings: Map<number, NATPortMapping> = new Map();
  private device: NATDevice | null = null;
  private enabled: boolean;

  constructor(enabled: boolean = true) {
    super();
    this.enabled = enabled;
  }

  async initialize(): Promise<void> {
    if (!this.enabled) {
      logger.info('NAT traversal disabled');
      return;
    }

    logger.warn(
      'NAT traversal temporarily disabled due to security vulnerabilities in nat-api dependency'
    );
    logger.warn('Use relay/TURN servers or configure port forwarding manually');
    logger.info('NAT Manager initialized in disabled mode');
  }

  async mapPort(privatePort: number, publicPort: number): Promise<boolean> {
    if (!this.enabled) {
      logger.info(`NAT mapping skipped (disabled): ${privatePort} -> ${publicPort}`);
      return false;
    }

    logger.warn('Port mapping not available - NAT traversal disabled');
    return false;
  }

  async unmapPort(publicPort: number): Promise<boolean> {
    if (!this.enabled) {
      return true;
    }

    this.mappings.delete(publicPort);
    logger.info(`Port unmapping skipped: ${publicPort}`);
    return true;
  }

  async getExternalIP(): Promise<string | null> {
    if (!this.enabled) {
      return null;
    }

    logger.info('External IP detection not available - NAT traversal disabled');
    return null;
  }

  async cleanup(): Promise<void> {
    for (const [publicPort] of this.mappings) {
      await this.unmapPort(publicPort);
    }
    this.mappings.clear();
    logger.info('NAT Manager cleaned up');
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    logger.info(`NAT traversal ${enabled ? 'enabled' : 'disabled'}`);
  }
}

export default NATManager;
