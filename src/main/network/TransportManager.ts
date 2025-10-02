import { EventEmitter } from 'events';
import { WebRTCTransport } from './transport/WebRTCTransport';
import { WebSocketTransport } from './transport/WebSocketTransport';

interface TransportManagerOptions {
  webrtc: { iceServers: RTCIceServer[] };
  websocket: { url: string };
}

export class TransportManager extends EventEmitter {
  private readonly webrtc: WebRTCTransport;
  private readonly websocket: WebSocketTransport;

  constructor(options: TransportManagerOptions) {
    super();
    this.webrtc = new WebRTCTransport(options.webrtc);
    this.websocket = new WebSocketTransport(options.websocket.url);

    this.webrtc.on('message', (data) => this.emit('message', data));
    this.webrtc.on('open', () => this.emit('open'));
    this.webrtc.on('close', () => this.emit('close'));
    this.webrtc.on('error', (error) => this.emit('error', error));

    this.websocket.on('message', (data) => this.emit('message', data));
    this.websocket.on('open', () => this.emit('open'));
    this.websocket.on('close', () => this.emit('close'));
    this.websocket.on('error', (error) => this.emit('error', error));
  }

  getWebRTC(): WebRTCTransport {
    return this.webrtc;
  }

  getWebSocket(): WebSocketTransport {
    return this.websocket;
  }
}
