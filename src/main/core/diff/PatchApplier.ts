import * as fs from 'fs/promises';
import { DeltaChunk } from './DiffTypes';

export class PatchApplier {
  async apply(basePath: string, outputPath: string, chunks: DeltaChunk[]): Promise<void> {
    const base = await fs.readFile(basePath);

    // ✅ CRITICAL FIX: Calculate final size dynamically
    let finalSize = base.length;
    for (const chunk of chunks) {
      if (chunk.type === 'insert' && chunk.data) {
        const chunkEnd = chunk.offset + chunk.data.length;
        if (chunkEnd > finalSize) {
          finalSize = chunkEnd;
        }
      }
    }

    // Allocate buffer with correct size
    const output = Buffer.alloc(finalSize);

    // Copy base data (only up to base.length)
    base.copy(output, 0, 0, Math.min(base.length, finalSize));

    // Apply patches
    for (const chunk of chunks) {
      if (chunk.type === 'copy') {
        // Data already copied from base
        continue;
      } else if (chunk.type === 'insert' && chunk.data) {
        // Insert new/changed data
        chunk.data.copy(output, chunk.offset, 0, chunk.data.length);
      } else if (chunk.type === 'delete' && chunk.length) {
        // Zero out deleted region
        output.fill(0, chunk.offset, chunk.offset + chunk.length);
      }
    }

    await fs.writeFile(outputPath, output);
  }
}
