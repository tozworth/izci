const PUBLIC_STUN_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' }
];

export interface MultiplayerIceSettings {
  multiplayerTurnUrl: string;
  multiplayerTurnUsername: string;
  multiplayerTurnCredential: string;
  multiplayerForceTurn: boolean;
}

export function createMultiplayerRtcConfiguration(settings: MultiplayerIceSettings): RTCConfiguration {
  const turnUrl = settings.multiplayerTurnUrl.trim();
  const turnServer: RTCIceServer[] = turnUrl
    ? [{
        urls: createTurnUrls(turnUrl),
        ...(settings.multiplayerTurnUsername || settings.multiplayerTurnCredential
          ? {
              username: settings.multiplayerTurnUsername,
              credential: settings.multiplayerTurnCredential
            }
          : {})
      }]
    : [];

  return {
    iceServers: [...PUBLIC_STUN_SERVERS, ...turnServer],
    iceTransportPolicy: settings.multiplayerForceTurn && turnUrl ? 'relay' : 'all'
  };
}

function createTurnUrls(url: string): string | string[] {
  if (!/^turn:/i.test(url) || /[?&]transport=/i.test(url)) return url;
  return [url, `${url}${url.includes('?') ? '&' : '?'}transport=tcp`];
}
