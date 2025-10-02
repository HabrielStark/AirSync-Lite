import { EventEmitter } from 'events';
import { ProtocolMessage } from './protocol/Protocol';

export class MessageBus extends EventEmitter {
  send(message: ProtocolMessage): void {
    this.emit('message', message);
  }

  subscribe(handler: (message: ProtocolMessage) => void): void {
    this.on('message', handler);
  }

  unsubscribe(handler: (message: ProtocolMessage) => void): void {
    this.off('message', handler);
  }
}
