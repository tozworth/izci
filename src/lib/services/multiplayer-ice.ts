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
