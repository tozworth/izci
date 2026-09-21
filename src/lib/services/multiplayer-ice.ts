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

export interface ServerIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface ServerIceResponse {
  iceServers: ServerIceServer[];
  /** TURN credential expiry; absent for STUN-only and empty configs. */
  expiresAt?: string | null;
}

/**
 * RTC configuration from an authenticated server ICE response. The
 * default configuration is empty (no servers); relay-only mode without a
 * relayed entry throws a useful error instead of failing silently.
 */
export function createServerRtcConfiguration(
  servers: ServerIceServer[],
  options: { forceRelay?: boolean } = {}
): RTCConfiguration {
  const entries = Array.isArray(servers) ? servers.slice(0, 16) : [];
  const iceServers: RTCIceServer[] = [];
  let hasRelay = false;
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const urls = Array.isArray(entry.urls) ? entry.urls : [entry.urls];
    const cleanUrls = urls.filter((url) => typeof url === 'string' && url.length > 0 && url.length <= 256);
    if (cleanUrls.length === 0) continue;
    const server: RTCIceServer = { urls: cleanUrls.length === 1 ? cleanUrls[0] : cleanUrls };
    if (typeof entry.username === 'string' && entry.username.length > 0
      && typeof entry.credential === 'string' && entry.credential.length > 0) {
      server.username = entry.username.slice(0, 256);
      server.credential = entry.credential.slice(0, 512);
      hasRelay = hasRelay || cleanUrls.some((url) => /^(?:turn|turns):/i.test(url));
    }
    iceServers.push(server);
  }
  if (options.forceRelay && !hasRelay) {
    throw new Error('Relay-only mode needs a TURN relay on this server; ask the operator to configure one or turn relaying off.');
  }
  return {
    iceServers,
    iceTransportPolicy: options.forceRelay && hasRelay ? 'relay' : 'all'
  };
}

export type MultiplayerConnectionRoute = 'direct' | 'relayed';

interface IceStatsRecord {
  id: string;
  type: string;
  selectedCandidatePairId?: string;
  localCandidateId?: string;
  remoteCandidateId?: string;
  candidateType?: string;
  nominated?: boolean;
  selected?: boolean;
  state?: string;
}

export function resolveMultiplayerConnectionRoute(
  stats: Iterable<IceStatsRecord>
): MultiplayerConnectionRoute | null {
  const records = [...stats];
  const byId = new Map(records.map((record) => [record.id, record]));
  const selectedPairId = records.find(
    (record) => record.type === 'transport' && record.selectedCandidatePairId
  )?.selectedCandidatePairId;
  const candidatePair = selectedPairId
    ? byId.get(selectedPairId)
    : records.find((record) => record.type === 'candidate-pair'
        && (record.selected || (record.nominated && record.state === 'succeeded')));
  if (!candidatePair?.localCandidateId || !candidatePair.remoteCandidateId) return null;

  const localCandidate = byId.get(candidatePair.localCandidateId);
  const remoteCandidate = byId.get(candidatePair.remoteCandidateId);
  if (!localCandidate || !remoteCandidate) return null;
  return localCandidate.candidateType === 'relay' || remoteCandidate.candidateType === 'relay'
    ? 'relayed'
    : 'direct';
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
