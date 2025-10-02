import { ReplayProtector } from '../../src/main/network/security/ReplayProtector';

describe('ReplayProtector', () => {
  let protector: ReplayProtector;

  beforeEach(() => {
    protector = new ReplayProtector(10000, 1000); // 10s window, 1000 max nonces
  });

  it('should accept valid nonce', () => {
    const result = protector.check('peer1', 'nonce1');
    expect(result).toBe(true);
  });

  it('should reject duplicate nonce', () => {
    protector.check('peer1', 'nonce1');
    const result = protector.check('peer1', 'nonce1');
    expect(result).toBe(false);
  });

  it('should allow same nonce for different peers', () => {
    protector.check('peer1', 'nonce1');
    const result = protector.check('peer2', 'nonce1');
    expect(result).toBe(true);
  });

  it('should accept nonce after window expires', async () => {
    protector = new ReplayProtector(100, 1000); // 100ms window
    
    protector.check('peer1', 'nonce1');
    
    await new Promise(resolve => setTimeout(resolve, 150));
    
    const result = protector.check('peer1', 'nonce1');
    expect(result).toBe(true);
  });

  it('should handle high volume of nonces', () => {
    for (let i = 0; i < 10000; i++) {
      const result = protector.check('peer1', `nonce${i}`);
      expect(result).toBe(true);
    }
  });

  it('should enforce max nonces limit', () => {
    protector = new ReplayProtector(10000, 10); // small limit
    
    for (let i = 0; i < 15; i++) {
      protector.check('peer1', `nonce${i}`);
    }
    
    // Should still work, old nonces should be cleaned
    const result = protector.check('peer1', 'new-nonce');
    expect(result).toBe(true);
  });

  it('should clean up old entries', () => {
    protector = new ReplayProtector(50, 100);
    
    protector.check('peer1', 'nonce1');
    
    // Wait for cleanup
    setTimeout(() => {
      const result = protector.check('peer1', 'nonce1');
      expect(result).toBe(true);
    }, 100);
  });
});
