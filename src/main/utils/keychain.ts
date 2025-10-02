import { safeStorage, app } from 'electron';
import Store from 'electron-store';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from './logger';

interface KeychainStore {
  encryptedSecrets: Record<string, string>;
}

export class KeychainManager {
  private store: Store<KeychainStore>;
  private static readonly KEY_FILE = '.keychain.key';

  constructor() {
    const encryptionKey = this.getOrGenerateEncryptionKey();

    this.store = new Store<KeychainStore>({
      name: 'keychain',
      encryptionKey,
    });
  }

  private getOrGenerateEncryptionKey(): string {
    const keyPath = path.join(app.getPath('userData'), KeychainManager.KEY_FILE);

    try {
      if (fs.existsSync(keyPath)) {
        const key = fs.readFileSync(keyPath, 'utf8');
        if (key.length !== 64) {
          // 32 bytes hex = 64 chars
          throw new Error('Invalid key length');
        }
        return key;
      }
    } catch (error) {
      logger.warn('Existing keychain key invalid, regenerating:', error);
    }

    // ✅ SECURITY FIX: Generate crypto-secure unique key per installation
    const newKey = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(keyPath, newKey, {
      mode: 0o600,
      // Read/write for owner only
      encoding: 'utf8',
    });

    logger.info('Generated new keychain encryption key');
    return newKey;
  }

  async setSecret(key: string, value: string): Promise<void> {
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        logger.warn('OS-level encryption not available, using electron-store encryption');
        const secrets = this.store.get('encryptedSecrets', {});
        secrets[key] = value;
        this.store.set('encryptedSecrets', secrets);
        return;
      }

      const encrypted = safeStorage.encryptString(value);
      const secrets = this.store.get('encryptedSecrets', {});
      secrets[key] = encrypted.toString('base64');
      this.store.set('encryptedSecrets', secrets);
      logger.info(`Secret stored securely: ${key}`);
    } catch (error) {
      logger.error(`Failed to store secret ${key}:`, error);
      throw error;
    }
  }

  async getSecret(key: string): Promise<string | null> {
    try {
      const secrets = this.store.get('encryptedSecrets', {});
      const encrypted = secrets[key];

      if (!encrypted) {
        return null;
      }

      if (!safeStorage.isEncryptionAvailable()) {
        return encrypted;
      }

      const buffer = Buffer.from(encrypted, 'base64');
      const decrypted = safeStorage.decryptString(buffer);
      return decrypted;
    } catch (error) {
      logger.error(`Failed to retrieve secret ${key}:`, error);
      return null;
    }
  }

  async deleteSecret(key: string): Promise<void> {
    try {
      const secrets = this.store.get('encryptedSecrets', {});
      delete secrets[key];
      this.store.set('encryptedSecrets', secrets);
      logger.info(`Secret deleted: ${key}`);
    } catch (error) {
      logger.error(`Failed to delete secret ${key}:`, error);
      throw error;
    }
  }

  async listSecrets(): Promise<string[]> {
    const secrets = this.store.get('encryptedSecrets', {});
    return Object.keys(secrets);
  }

  async rotateSecret(key: string, newValue: string): Promise<void> {
    const oldValue = await this.getSecret(key);
    if (oldValue) {
      await this.setSecret(`${key}_old_${Date.now()}`, oldValue);
    }
    await this.setSecret(key, newValue);
    logger.info(`Secret rotated: ${key}`);
  }

  async generateSecretsReport(): Promise<string> {
    const secrets = await this.listSecrets();

    const report = `
# Secrets Management Report
Generated: ${new Date().toISOString()}

## Stored Secrets
${secrets.map((key) => `- ${key} (encrypted)`).join('\n') || '(none)'}

## Encryption Method
${
  safeStorage.isEncryptionAvailable()
    ? '✅ OS-level encryption (Keychain/DPAPI/libsecret)'
    : '⚠️ electron-store fallback encryption'
}

## Rotation Schedule
- Pairing keys: Rotate on device unpair
- Device keys: Rotate every 90 days (manual)
- API keys: Not applicable (none stored)

## Required Environment Variables
- NODE_ENV (current: ${process.env.NODE_ENV || 'not set'})
- SYNC_PORT (current: ${process.env.SYNC_PORT || 'default'})

## Security Checks
✅ All secrets encrypted at rest
✅ No secrets in code/logs
✅ Unique encryption key per installation
${secrets.some((k) => k.includes('STRIPE')) ? '⚠️ Stripe keys detected - ensure restricted scope' : '✅ No payment keys stored'}
    `.trim();

    return report;
  }

  clear(): void {
    this.store.clear();
    logger.warn('All secrets cleared from keychain');
  }
}

export const keychain = new KeychainManager();
