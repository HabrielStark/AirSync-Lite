import { EventEmitter } from 'events';

type WrtcModule = typeof import('wrtc');

let wrtcModule: WrtcModule | null | undefined;

function loadWrtc(): WrtcModule | null {
  if (wrtcModule === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      wrtcModule = require('wrtc');
    } catch (error) {
      wrtcModule = null;
    }
  }
  return wrtcModule ?? null;
}

export interface WebRTCTransportOptions {
  iceServers: RTCIceServer[];
}

export class WebRTCTransport extends EventEmitter {
  static isSupported(): boolean {
    return loadWrtc() !== null;
  }

  private readonly connection: RTCPeerConnection;
  private channel?: RTCDataChannel;

  constructor(private readonly options: WebRTCTransportOptions) {
    super();

    const wrtc = loadWrtc();
    if (!wrtc) {
      throw new Error(
        'wrtc native module not available. Install optional dependency or disable WebRTC support.'
      );
    }

    const PeerConnectionCtor = (wrtc.RTCPeerConnection ??
      (wrtc as any).RTCPeerConnection) as typeof RTCPeerConnection;
    this.connection = new PeerConnectionCtor({ iceServers: options.iceServers });

    this.connection.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
      if (event.candidate) {
        this.emit('ice-candidate', event.candidate);
      }
    };

    this.connection.ondatachannel = (event: RTCDataChannelEvent) => {
      this.channel = event.channel;
      this.setupChannel();
    };
  }

  createOffer(): Promise<RTCSessionDescriptionInit> {
    this.channel = this.connection.createDataChannel('sync');
    this.setupChannel();
    return this.connection
      .createOffer()
      .then((offer) => this.connection.setLocalDescription(offer).then(() => offer));
  }

  applyAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    return this.connection.setRemoteDescription(answer);
  }

  createAnswer(): Promise<RTCSessionDescriptionInit> {
    return this.connection
      .createAnswer()
      .then((answer) => this.connection.setLocalDescription(answer).then(() => answer));
  }

  applyOffer(offer: RTCSessionDescriptionInit): Promise<void> {
    return this.connection.setRemoteDescription(offer);
  }

  addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    return this.connection.addIceCandidate(candidate);
  }

  send(data: Buffer): void {
    this.channel?.send(data);
  }

  close(): void {
    this.channel?.close();
    this.connection.close();
  }

  private setupChannel(): void {
    if (!this.channel) {
      return;
    }

    this.channel.onmessage = (event: MessageEvent) => {
      const payload =
        typeof event.data === 'string' ? Buffer.from(event.data) : Buffer.from(event.data);
      this.emit('message', payload);
    };

    this.channel.onopen = () => this.emit('open');
    this.channel.onclose = () => this.emit('close');
    this.channel.onerror = (error) => this.emit('error', error);
  }
}
