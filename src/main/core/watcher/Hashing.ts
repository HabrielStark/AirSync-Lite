import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface HashOptions {
  blockSize: number;
  algorithm: 'sha256' | 'sha1' | 'md5';
  rollingWindow?: number;
}

export interface FileHash {
  absolutePath: string;
  size: number;
  hash: string;
  blocks: string[];
}

export class Hashing {
  constructor(private readonly options: HashOptions) {}

  async hashFile(filePath: string): Promise<FileHash> {
    const stat = await fs.stat(filePath);
    const handle = await fs.open(filePath, 'r');
    const blocks: string[] = [];

    try {
      const buffer = Buffer.alloc(this.options.blockSize);
      let position = 0;

      while (position < stat.size) {
        const { bytesRead: read } = await handle.read(buffer, 0, this.options.blockSize, position);
        if (read <= 0) {
          break;
        }
        position += read;
        const chunk = buffer.slice(0, read);
        blocks.push(this.digest(chunk));
      }
    } finally {
      await handle.close();
    }

    // ✅ CRITICAL FIX: Proper Buffer concatenation instead of string join
    const combinedBuffer = Buffer.concat(blocks.map((h) => Buffer.from(h, 'hex')));
    const combinedHash = this.digest(combinedBuffer);

    return {
      absolutePath: path.resolve(filePath),
      size: stat.size,
      hash: combinedHash,
      blocks,
    };
  }

  createRollingHash(): RollingHash {
    return new RollingHash(this.options);
  }

  private digest(buffer: Buffer): string {
    return crypto.createHash(this.options.algorithm).update(buffer).digest('hex');
  }
}

export class RollingHash {
  private readonly window: number;
  private readonly modulus = 1_000_000_007;
  private readonly base = 257;
  private currentHash = 0;
  private highestBasePower = 1;
  private buffer: number[] = [];

  constructor(options: HashOptions) {
    this.window = options.rollingWindow ?? options.blockSize;
  }

  push(byte: number): void {
    if (this.buffer.length === this.window) {
      this.pop();
    }

    this.buffer.push(byte);
    this.currentHash = (this.currentHash * this.base + byte) % this.modulus;

    if (this.buffer.length > 1) {
      this.highestBasePower = (this.highestBasePower * this.base) % this.modulus;
    }
  }

  pop(): void {
    if (this.buffer.length === 0) {
      return;
    }

    const byte = this.buffer.shift();
    if (byte === undefined) {
      return;
    }

    this.currentHash =
      (this.currentHash - ((byte * this.highestBasePower) % this.modulus) + this.modulus) %
      this.modulus;

    if (this.buffer.length === 0) {
      this.currentHash = 0;
      this.highestBasePower = 1;
    }
  }

  value(): number {
    return this.currentHash;
  }

  reset(): void {
    this.buffer = [];
    this.currentHash = 0;
    this.highestBasePower = 1;
  }
}
