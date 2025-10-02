import { EventEmitter } from 'events';

interface IntrusionEvent {
  peerId: string;
  type: 'rate-limit' | 'invalid-signature' | 'replay';
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export class IntrusionDetection extends EventEmitter {
  private readonly events: IntrusionEvent[] = [];

  report(event: IntrusionEvent): void {
    this.events.push(event);
    this.emit('intrusion', event);
  }

  getEvents(): IntrusionEvent[] {
    return this.events;
  }
}
