export interface TransferInitMessage {
  transferId: string;
  file: {
    path: string;
    name: string;
    size: number;
    hash?: string;
    modifiedAt?: Date | string;
  };
  totalChunks: number;
  chunkSize: number;
  compressed: boolean;
}

export interface TransferChunkMessage {
  transferId: string;
  chunkIndex: number;
  data: string; // base64
  hash: string;
}

export interface TransferCompleteMessage {
  transferId: string;
  fileHash?: string;
}

export interface TransferErrorMessage {
  transferId: string;
  error: string;
}

export interface TransferRequestMessage {
  transferId: string;
  folderId: string;
  relativePath: string;
  hash?: string;
}
