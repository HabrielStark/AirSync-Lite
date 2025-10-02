export type ProtocolMessage =
  | DiscoveryAnnouncement
  | PairingRequest
  | PairingResponse
  | SyncMessage;

export interface DiscoveryAnnouncement {
  type: 'discovery-announcement';
  peerId: string;
  address: string;
  port: number;
  capabilities: Record<string, unknown>;
  timestamp: number;
}

export interface PairingRequest {
  type: 'pairing-request';
  peerId: string;
  code: string;
  publicKey: string;
  nonce: string;
}

export interface PairingResponse {
  type: 'pairing-response';
  peerId: string;
  accepted: boolean;
  publicKey?: string;
  capabilities?: Record<string, unknown>;
}

export interface SyncMessage {
  type: 'sync-message';
  peerId: string;
  folderId: string;
  payload: Buffer;
  signature: string;
}
