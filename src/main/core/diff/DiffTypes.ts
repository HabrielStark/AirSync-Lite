export interface DiffBlock {
  offset: number;
  length: number;
  hash: string;
}

export interface DeltaChunk {
  type: 'copy' | 'insert' | 'delete';
  offset: number;
  length?: number;
  data?: Buffer;
}

export interface RollingDiffResult {
  baseHash: string;
  targetHash: string;
  blocks: DiffBlock[];
  delta: DeltaChunk[];
}
