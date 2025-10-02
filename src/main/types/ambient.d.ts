declare module 'micromatch' {
  const micromatch: any;
  export default micromatch;
}

declare module 'lodash.debounce' {
  export default function debounce<T extends (...args: any[]) => any>(fn: T, wait?: number): T;
}

declare module 'wrtc' {
  export const RTCPeerConnection: any;
  export type RTCSessionDescriptionInit = any;
  export type RTCIceCandidateInit = any;
}
