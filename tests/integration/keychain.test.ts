import { KeychainManager } from '../../src/main/utils/keychain';

describe('KeychainManager', () => {
  let keychain: KeychainManager;

  beforeEach(() => {
    keychain = new KeychainManager();
    keychain.clear();
  });

  afterEach(() => {
    keychain.clear();
  });

  it('should store and retrieve a secret', async () => {
    const key = 'test-secret';
    const value = 'my-secret-value';

    await keychain.setSecret(key, value);
    const retrieved = await keychain.getSecret(key);

    expect(retrieved).toBe(value);
  });

  it('should return null for non-existent secrets', async () => {
    const result = await keychain.getSecret('non-existent');
    expect(result).toBeNull();
  });

  it('should delete secrets', async () => {
    const key = 'temp-secret';
    await keychain.setSecret(key, 'temporary');
    
    await keychain.deleteSecret(key);
    const result = await keychain.getSecret(key);
    
    expect(result).toBeNull();
  });

  it('should list all secret keys', async () => {
    await keychain.setSecret('secret1', 'value1');
    await keychain.setSecret('secret2', 'value2');
    await keychain.setSecret('secret3', 'value3');

    const keys = await keychain.listSecrets();

    expect(keys).toHaveLength(3);
    expect(keys).toContain('secret1');
    expect(keys).toContain('secret2');
    expect(keys).toContain('secret3');
  });

  it('should rotate secrets and keep old version', async () => {
    const key = 'rotate-test';
    const oldValue = 'old-value';
    const newValue = 'new-value';

    await keychain.setSecret(key, oldValue);
    await keychain.rotateSecret(key, newValue);

    const current = await keychain.getSecret(key);
    const keys = await keychain.listSecrets();
    const oldKeys = keys.filter(k => k.startsWith(`${key}_old_`));

    expect(current).toBe(newValue);
    expect(oldKeys.length).toBeGreaterThan(0);
  });

  it('should handle multiple secrets independently', async () => {
    await keychain.setSecret('key1', 'value1');
    await keychain.setSecret('key2', 'value2');
    await keychain.setSecret('key3', 'value3');

    expect(await keychain.getSecret('key1')).toBe('value1');
    expect(await keychain.getSecret('key2')).toBe('value2');
    expect(await keychain.getSecret('key3')).toBe('value3');

    await keychain.deleteSecret('key2');

    expect(await keychain.getSecret('key1')).toBe('value1');
    expect(await keychain.getSecret('key2')).toBeNull();
    expect(await keychain.getSecret('key3')).toBe('value3');
  });

  it('should clear all secrets', async () => {
    await keychain.setSecret('key1', 'value1');
    await keychain.setSecret('key2', 'value2');

    keychain.clear();

    const keys = await keychain.listSecrets();
    expect(keys).toHaveLength(0);
  });
});
