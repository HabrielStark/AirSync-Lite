import { EventEmitter } from 'events';
import WebSocket from 'ws';

export class WebSocketTransport extends EventEmitter {
  private socket?: WebSocket;

  constructor(private readonly url: string) {
    super();
  }

  connect(): void {
    this.socket = new WebSocket(this.url);
    this.socket.on('open', () => this.emit('open'));
    this.socket.on('close', () => this.emit('close'));
    this.socket.on('error', (error) => this.emit('error', error));
    this.socket.on('message', (data) => {
      this.emit('message', Buffer.from(data as Buffer));
    });
  }

  send(data: Buffer): void {
    this.socket?.send(data);
  }

  close(): void {
    this.socket?.close();
  }
}
