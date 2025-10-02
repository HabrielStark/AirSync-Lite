import { RateLimiter } from '../../src/main/network/security/RateLimiter';

describe('RateLimiter', () => {
  it('should allow requests within limit', async () => {
    const limiter = new RateLimiter({ points: 5, duration: 1, blockDuration: 5 });

    for (let i = 0; i < 5; i++) {
      const result = await limiter.consume('user1');
      expect(result.success).toBe(true);
    }
  });

  it('should block requests exceeding limit', async () => {
    const limiter = new RateLimiter({ points: 3, duration: 1, blockDuration: 5 });

    await limiter.consume('user1');
    await limiter.consume('user1');
    await limiter.consume('user1');

    const result = await limiter.consume('user1');
    expect(result.success).toBe(false);
    expect(result.msBeforeNext).toBeGreaterThan(0);
  });

  it('should handle multiple users independently', async () => {
    const limiter = new RateLimiter({ points: 2, duration: 1, blockDuration: 5 });

    await limiter.consume('user1');
    await limiter.consume('user1');
    const user1Result = await limiter.consume('user1');

    const user2Result = await limiter.consume('user2');

    expect(user1Result.success).toBe(false);
    expect(user2Result.success).toBe(true);
  });

  it('should reset after duration expires', async () => {
    const limiter = new RateLimiter({ points: 2, duration: 0.1, blockDuration: 0.2 });

    await limiter.consume('user1');
    await limiter.consume('user1');
    
    // Wait for duration to expire
    await new Promise(resolve => setTimeout(resolve, 150));

    const result = await limiter.consume('user1');
    expect(result.success).toBe(true);
  });

  it('should unblock after blockDuration', async () => {
    const limiter = new RateLimiter({ points: 1, duration: 0.1, blockDuration: 0.2 });

    await limiter.consume('user1');
    const blocked = await limiter.consume('user1');
    expect(blocked.success).toBe(false);

    // Wait for block to expire
    await new Promise(resolve => setTimeout(resolve, 250));

    const unblocked = await limiter.consume('user1');
    expect(unblocked.success).toBe(true);
  });

  it('should support manual reset', async () => {
    const limiter = new RateLimiter({ points: 2, duration: 10, blockDuration: 10 });

    await limiter.consume('user1');
    await limiter.consume('user1');
    const blocked = await limiter.consume('user1');
    expect(blocked.success).toBe(false);

    limiter.reset('user1');

    const result = await limiter.consume('user1');
    expect(result.success).toBe(true);
  });

  it('should track remaining points', async () => {
    const limiter = new RateLimiter({ points: 5, duration: 1, blockDuration: 5 });

    const result1 = await limiter.consume('user1');
    expect(result1.remainingPoints).toBe(4);

    const result2 = await limiter.consume('user1');
    expect(result2.remainingPoints).toBe(3);

    const result3 = await limiter.consume('user1', 2);
    expect(result3.remainingPoints).toBe(1);
  });

  it('should support legacy check method', () => {
    const limiter = new RateLimiter({ points: 3, duration: 1, blockDuration: 5 });

    expect(limiter.check('user1')).toBe(true);
    expect(limiter.check('user1')).toBe(true);
    expect(limiter.check('user1')).toBe(true);
    expect(limiter.check('user1')).toBe(false);
  });

  it('should emit rate-limit event when limit exceeded', async () => {
    const limiter = new RateLimiter({ points: 2, duration: 1, blockDuration: 5 });
    
    const rateLimitSpy = jest.fn();
    limiter.on('rate-limit', rateLimitSpy);

    await limiter.consume('user1');
    await limiter.consume('user1');
    await limiter.consume('user1');

    expect(rateLimitSpy).toHaveBeenCalledWith('user1');
  });
});
