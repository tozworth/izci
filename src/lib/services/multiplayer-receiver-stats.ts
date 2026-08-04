export interface MultiplayerReceiverCounterSample {
  timestamp: number;
  packetsReceived: number;
  packetsLost: number;
}

export interface MultiplayerPacketLossStats {
  samples: MultiplayerReceiverCounterSample[];
  recentReceived: number;
  recentLost: number;
  recentPercent: number | null;
  totalReceived: number;
  totalLost: number;
  totalPercent: number | null;
}

function lossPercent(received: number, lost: number): number | null {
  const sent = received + lost;
  return sent > 0 ? Math.round((lost / sent) * 10_000) / 100 : null;
}

export function updateMultiplayerPacketLossStats(
  previous: MultiplayerReceiverCounterSample[],
  sample: MultiplayerReceiverCounterSample,
  windowMs = 30_000
): MultiplayerPacketLossStats {
  const latest = previous.at(-1);
  const countersReset = Boolean(latest && (
    sample.timestamp <= latest.timestamp
    || sample.packetsReceived < latest.packetsReceived
    || sample.packetsLost < latest.packetsLost
  ));
  const samples = (!latest || countersReset ? [sample] : [...previous, sample]).filter(
    (candidate) => candidate.timestamp >= sample.timestamp - windowMs
  );
  const first = samples[0] ?? sample;
  const recentReceived = Math.max(0, sample.packetsReceived - first.packetsReceived);
  const recentLost = Math.max(0, sample.packetsLost - first.packetsLost);

  return {
    samples,
    recentReceived,
    recentLost,
    recentPercent: lossPercent(recentReceived, recentLost),
    totalReceived: sample.packetsReceived,
    totalLost: sample.packetsLost,
    totalPercent: lossPercent(sample.packetsReceived, sample.packetsLost)
  };
}
