import * as fs from 'fs/promises';
import { Hashing } from '../watcher/Hashing';
import { DiffBlock, RollingDiffResult } from './DiffTypes';

export interface RollingDiffOptions {
  blockSize: number;
}

export class RollingDiff {
  private readonly hashing: Hashing;

  constructor(private readonly options: RollingDiffOptions) {
    this.hashing = new Hashing({ algorithm: 'sha256', blockSize: options.blockSize });
  }

  async diff(basePath: string, targetPath: string): Promise<RollingDiffResult> {
    const baseHash = await this.hashing.hashFile(basePath);
    const targetHash = await this.hashing.hashFile(targetPath);

    const blocks: DiffBlock[] = [];

    baseHash.blocks.forEach((hash, index) => {
      blocks.push({
        offset: index * this.options.blockSize,
        length: this.options.blockSize,
        hash,
      });
    });

    // Read target file data for delta calculation
    const targetData = await fs.readFile(targetPath);
    const delta = await this.calculateDelta(
      blocks,
      targetHash.blocks,
      this.options.blockSize,
      targetData
    );

    return {
      baseHash: baseHash.hash,
      targetHash: targetHash.hash,
      blocks,
      delta,
    };
  }

  private async calculateDelta(
    baseBlocks: DiffBlock[],
    targetBlocks: string[],
    blockSize: number,
    targetData: Buffer
  ): Promise<
    Array<
      | { type: 'insert'; offset: number; data: Buffer }
      | { type: 'copy'; offset: number; length: number }
    >
  > {
    const delta: Array<
      | { type: 'insert'; offset: number; data: Buffer }
      | { type: 'copy'; offset: number; length: number }
    > = [];

    targetBlocks.forEach((hash, index) => {
      const base = baseBlocks[index];

      if (!base || base.hash !== hash) {
        // ✅ CRITICAL FIX: Insert REAL data, not hash!
        const start = index * blockSize;
        const end = Math.min(start + blockSize, targetData.length);
        const chunk = targetData.slice(start, end);

        delta.push({
          type: 'insert' as const,
          offset: index * blockSize,
          data: chunk,
        });
      } else {
        delta.push({
          type: 'copy' as const,
          offset: base.offset,
          length: base.length,
        });
      }
    });

    return delta;
  }
}
