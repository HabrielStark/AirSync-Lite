import { EventEmitter } from 'events';

export interface PeerInfo {
  id: string;
  name: string;
  address: string;
  port: number;
  status: 'unknown' | 'discovering' | 'connected' | 'disconnected';
  lastSeenAt?: number;
  capabilities?: Record<string, unknown>;
}

export class PeerRegistry extends EventEmitter {
  private readonly peers = new Map<string, PeerInfo>();

  upsert(peer: PeerInfo): void {
    const existing = this.peers.get(peer.id);
    const merged: PeerInfo = {
      ...existing,
      ...peer,
      status: peer.status,
      lastSeenAt: Date.now(),
    };

    this.peers.set(peer.id, merged);
    this.emit('peer-updated', merged);
  }

  get(peerId: string): PeerInfo | undefined {
    return this.peers.get(peerId);
  }

  list(): PeerInfo[] {
    return [...this.peers.values()];
  }

  markStatus(peerId: string, status: PeerInfo['status']): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    peer.status = status;
    peer.lastSeenAt = Date.now();
    this.emit('peer-updated', peer);
  }

  remove(peerId: string): void {
    if (this.peers.delete(peerId)) {
      this.emit('peer-removed', peerId);
    }
  }
}
