import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import { logger } from '../utils/logger';
import selfsigned from 'selfsigned';

interface Certificates {
  key: string;
  cert: string;
}

export class SecureChannel {
  private privateKey: string | null = null;
  private publicKey: string | null = null;
  private certificates: Certificates | null = null;
  private readonly keyPath: string;

  constructor(private readonly deviceId: string) {
    this.keyPath = path.join(app.getPath('userData'), 'keys');
  }

  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.keyPath, { recursive: true });
      await this.loadOrGenerateKeys();
      logger.info('Secure channel initialized');
    } catch (error) {
      logger.error('Failed to initialize secure channel:', error);
      throw error;
    }
  }

  async getPublicKey(): Promise<string> {
    if (!this.publicKey) {
      await this.loadOrGenerateKeys();
    }
    return this.publicKey!;
  }

  async sign(data: string | Buffer): Promise<string> {
    if (!this.privateKey) {
      await this.loadOrGenerateKeys();
    }

    const signer = crypto.createSign('SHA256');
    signer.update(data);
    signer.end();
    return signer.sign(this.privateKey!, 'hex');
  }

  async verifySignature(
    data: string | Buffer,
    signature: string,
    publicKey: string
  ): Promise<boolean> {
    try {
      const verifier = crypto.createVerify('SHA256');
      verifier.update(data);
      verifier.end();
      return verifier.verify(publicKey, signature, 'hex');
    } catch (error) {
      logger.error('Signature verification failed:', error);
      return false;
    }
  }

  async encrypt(data: Buffer, publicKey: string): Promise<Buffer> {
    const aesKey = crypto.randomBytes(32);
    const iv = crypto.randomBytes(16);

    const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
    const encryptedData = Buffer.concat([cipher.update(data), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const encryptedKey = crypto.publicEncrypt(
      {
        key: publicKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      aesKey
    );

    const keyLength = Buffer.alloc(2);
    keyLength.writeUInt16BE(encryptedKey.length, 0);

    return Buffer.concat([keyLength, encryptedKey, iv, authTag, encryptedData]);
  }

  async decrypt(data: Buffer): Promise<Buffer> {
    if (!this.privateKey) {
      await this.loadOrGenerateKeys();
    }

    let offset = 0;
    const keyLength = data.readUInt16BE(offset);
    offset += 2;

    const encryptedKey = data.slice(offset, offset + keyLength);
    offset += keyLength;

    const iv = data.slice(offset, offset + 16);
    offset += 16;

    const authTag = data.slice(offset, offset + 16);
    offset += 16;

    const encryptedPayload = data.slice(offset);

    const aesKey = crypto.privateDecrypt(
      {
        key: this.privateKey!,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      encryptedKey
    );

    const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encryptedPayload), decipher.final()]);
  }

  async generateCertificates(): Promise<Certificates> {
    if (this.certificates) {
      return this.certificates;
    }

    const certPath = path.join(this.keyPath, 'cert.pem');
    const keyPath = path.join(this.keyPath, 'cert-key.pem');

    try {
      const [cert, key] = await Promise.all([
        fs.readFile(certPath, 'utf8'),
        fs.readFile(keyPath, 'utf8'),
      ]);
      this.certificates = { cert, key };
      return this.certificates;
    } catch {
      const cert = this.generateSelfSignedCert();
      const key = this.privateKey!;

      await Promise.all([
        fs.writeFile(certPath, cert),
        fs.writeFile(keyPath, key, { mode: 0o600 }),
      ]);

      this.certificates = { cert, key };
      return this.certificates;
    }
  }

  private async loadOrGenerateKeys(): Promise<void> {
    const privateKeyPath = path.join(this.keyPath, 'private.key');
    const publicKeyPath = path.join(this.keyPath, 'public.key');

    try {
      const [privateKey, publicKey] = await Promise.all([
        fs.readFile(privateKeyPath, 'utf8'),
        fs.readFile(publicKeyPath, 'utf8'),
      ]);
      this.privateKey = privateKey;
      this.publicKey = publicKey;
    } catch {
      const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 4096,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });

      this.privateKey = privateKey;
      this.publicKey = publicKey;

      await Promise.all([
        fs.writeFile(privateKeyPath, privateKey, { mode: 0o600 }),
        fs.writeFile(publicKeyPath, publicKey),
      ]);
    }
  }

  private generateSelfSignedCert(): string {
    const attrs = [
      { name: 'commonName', value: this.deviceId },
      { name: 'organizationName', value: 'AirSync-Lite' },
    ];

    const pems = selfsigned.generate(attrs, {
      keySize: 2048,
      days: 365,
      algorithm: 'sha256',
      extensions: [
        {
          name: 'basicConstraints',
          cA: true,
        },
        {
          name: 'keyUsage',
          keyCertSign: true,
          digitalSignature: true,
          keyEncipherment: true,
        },
      ],
    });

    // Store both cert and key for later use
    this.certificates = {
      cert: pems.cert,
      key: pems.private,
    };

    return pems.cert;
  }
}
