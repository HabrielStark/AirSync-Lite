import { DeltaChunk } from './DiffTypes';

export class DeltaEncoder {
  encode(chunks: DeltaChunk[]): Buffer {
    const parts: Buffer[] = [];

    for (const chunk of chunks) {
      if (chunk.type === 'copy') {
        const header = Buffer.alloc(9);
        header.writeUInt8(0x01, 0);
        header.writeUInt32BE(chunk.offset, 1);
        header.writeUInt32BE(chunk.length ?? 0, 5);
        parts.push(header);
      } else if (chunk.type === 'insert') {
        const data = chunk.data ?? Buffer.alloc(0);
        const header = Buffer.alloc(9);
        header.writeUInt8(0x02, 0);
        header.writeUInt32BE(chunk.offset, 1);
        header.writeUInt32BE(data.length, 5);
        parts.push(header, data);
      } else if (chunk.type === 'delete') {
        const header = Buffer.alloc(9);
        header.writeUInt8(0x03, 0);
        header.writeUInt32BE(chunk.offset, 1);
        header.writeUInt32BE(chunk.length ?? 0, 5);
        parts.push(header);
      }
    }

    return Buffer.concat(parts);
  }
}
