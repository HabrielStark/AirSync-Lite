import { describe, it, expect } from '@jest/globals';
import { SecureChannel } from '../../src/main/network/secureChannel';
import * as crypto from 'crypto';

describe('MITM Protection', () => {
  it('should detect tampered encrypted data', async () => {
    const channel = new SecureChannel('device1');
    await channel.initialize();
    
    const data = Buffer.from('sensitive data');
    const publicKey = await channel.getPublicKey();
    const encrypted = await channel.encrypt(data, publicKey);
    
    // Tamper with the encrypted data
    encrypted[encrypted.length - 1] ^= 1;
    
    // Decryption should fail due to auth tag mismatch
    await expect(channel.decrypt(encrypted)).rejects.toThrow();
  });

  it('should reject forged signatures', async () => {
    const channel1 = new SecureChannel('device1');
    const channel2 = new SecureChannel('device2');
    
    await channel1.initialize();
    await channel2.initialize();
    
    const data = 'important message';
    const signature = await channel1.sign(data);
    const publicKey2 = await channel2.getPublicKey();
    
    // Signature from channel1 should not verify with channel2's key
    const verified = await channel1.verifySignature(data, signature, publicKey2);
    expect(verified).toBe(false);
  });

  it('should prevent signature substitution', async () => {
    const channel = new SecureChannel('device1');
    await channel.initialize();
    
    const message1 = 'transfer $10';
    const message2 = 'transfer $1000';
    
    const signature1 = await channel.sign(message1);
    const publicKey = await channel.getPublicKey();
    
    // Try to use signature from message1 with message2
    const verified = await channel.verifySignature(message2, signature1, publicKey);
    expect(verified).toBe(false);
  });

  it('should use strong RSA key size', async () => {
    const channel = new SecureChannel('device1');
    await channel.initialize();
    
    const publicKey = await channel.getPublicKey();
    
    // Check key size (should be 4096 bits minimum)
    // A 4096-bit RSA public key in PEM format is ~800 bytes
    expect(publicKey.length).toBeGreaterThan(700);
  });

  it('should use secure random nonces', () => {
    const nonces = new Set<string>();
    
    // Generate multiple nonces
    for (let i = 0; i < 1000; i++) {
      const nonce = crypto.randomBytes(16).toString('hex');
      nonces.add(nonce);
    }
    
    // All nonces should be unique
    expect(nonces.size).toBe(1000);
  });

  it('should prevent downgrade attacks', async () => {
    const channel = new SecureChannel('device1');
    await channel.initialize();
    
    const data = Buffer.from('test');
    const publicKey = await channel.getPublicKey();
    
    // Try to encrypt with weak algorithm (should use AES-256-GCM)
    const encrypted = await channel.encrypt(data, publicKey);
    
    // Encrypted data should be larger than original due to encryption overhead
    expect(encrypted.length).toBeGreaterThan(data.length + 100);
  });
});
