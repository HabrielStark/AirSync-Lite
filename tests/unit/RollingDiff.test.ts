import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { RollingDiff } from '../../src/main/core/diff/RollingDiff';
import { PatchApplier } from '../../src/main/core/diff/PatchApplier';

describe('RollingDiff & PatchApplier (CRITICAL BUG FIXES)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'diff-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('✅ BUG FIX #1: should insert REAL data, not hash', async () => {
    const basePath = path.join(tempDir, 'base.txt');
    const targetPath = path.join(tempDir, 'target.txt');
    const outputPath = path.join(tempDir, 'output.txt');

    // Create base file
    await fs.writeFile(basePath, 'Hello World');

    // Create target file (modified)
    await fs.writeFile(targetPath, 'Hello Amazing World');

    // Calculate diff
    const diff = new RollingDiff({ blockSize: 4096 });
    const result = await diff.diff(basePath, targetPath);

    // ✅ CRITICAL: Verify delta contains REAL data, not hashes
    const insertChunks = result.delta.filter(c => c.type === 'insert');
    expect(insertChunks.length).toBeGreaterThan(0);
    
    for (const chunk of insertChunks) {
      if (chunk.type === 'insert' && chunk.data) {
        // Data should be readable text, not hex hash
        const dataStr = chunk.data.toString();
        expect(dataStr).toContain('Amazing');
        // Should NOT be a hex hash
        expect(dataStr).not.toMatch(/^[0-9a-f]{64}$/i);
      }
    }

    // Apply patch and verify
    const applier = new PatchApplier();
    await applier.apply(basePath, outputPath, result.delta);

    const outputContent = await fs.readFile(outputPath, 'utf-8');
    const targetContent = await fs.readFile(targetPath, 'utf-8');

    expect(outputContent).toBe(targetContent);
  });

  it('✅ BUG FIX #2: should handle file growth correctly', async () => {
    const basePath = path.join(tempDir, 'base.txt');
    const targetPath = path.join(tempDir, 'target.txt');
    const outputPath = path.join(tempDir, 'output.txt');

    // Small base file
    await fs.writeFile(basePath, 'Short');

    // Much larger target file
    const largeContent = 'A'.repeat(10000) + '\n' + 'B'.repeat(10000);
    await fs.writeFile(targetPath, largeContent);

    // Calculate diff
    const diff = new RollingDiff({ blockSize: 4096 });
    const result = await diff.diff(basePath, targetPath);

    // Apply patch
    const applier = new PatchApplier();
    await applier.apply(basePath, outputPath, result.delta);

    // ✅ CRITICAL: Output should have correct size (not truncated)
    const outputContent = await fs.readFile(outputPath, 'utf-8');
    const targetContent = await fs.readFile(targetPath, 'utf-8');

    expect(outputContent.length).toBe(targetContent.length);
    expect(outputContent).toBe(targetContent);
  });

  it('should handle identical files', async () => {
    const basePath = path.join(tempDir, 'base.txt');
    const targetPath = path.join(tempDir, 'target.txt');

    const content = 'Identical content';
    await fs.writeFile(basePath, content);
    await fs.writeFile(targetPath, content);

    const diff = new RollingDiff({ blockSize: 4096 });
    const result = await diff.diff(basePath, targetPath);

    expect(result.baseHash).toBe(result.targetHash);
    expect(result.delta.every(c => c.type === 'copy')).toBe(true);
  });

  it('should handle complete file replacement', async () => {
    const basePath = path.join(tempDir, 'base.txt');
    const targetPath = path.join(tempDir, 'target.txt');
    const outputPath = path.join(tempDir, 'output.txt');

    await fs.writeFile(basePath, 'Old content');
    await fs.writeFile(targetPath, 'Completely new content');

    const diff = new RollingDiff({ blockSize: 4096 });
    const result = await diff.diff(basePath, targetPath);

    const applier = new PatchApplier();
    await applier.apply(basePath, outputPath, result.delta);

    const output = await fs.readFile(outputPath, 'utf-8');
    expect(output).toBe('Completely new content');
  });

  it('should handle binary data correctly', async () => {
    const basePath = path.join(tempDir, 'base.bin');
    const targetPath = path.join(tempDir, 'target.bin');
    const outputPath = path.join(tempDir, 'output.bin');

    const baseData = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]);
    const targetData = Buffer.from([0x00, 0xFF, 0x02, 0x03, 0xAA, 0xBB]);

    await fs.writeFile(basePath, baseData);
    await fs.writeFile(targetPath, targetData);

    const diff = new RollingDiff({ blockSize: 4096 });
    const result = await diff.diff(basePath, targetPath);

    const applier = new PatchApplier();
    await applier.apply(basePath, outputPath, result.delta);

    const output = await fs.readFile(outputPath);
    expect(Buffer.compare(output, targetData)).toBe(0);
  });
});
