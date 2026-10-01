export interface BuiltinSignalingOptions {
  port: number;
  publicUrl: string;
  upnp: boolean;
  iceUrls: string[];
  allowedOrigins: string[];
}

export interface BuiltinSignalingReady {
  endpoint: string;
  publicEndpoint: string;
  lanEndpoints: string[];
  sessionToken: string;
  mapping: 'off' | 'mapped' | 'unavailable';
}

export type SignalingSocket = Pick<WebSocket, 'addEventListener' | 'readyState' | 'send' | 'close'>;
