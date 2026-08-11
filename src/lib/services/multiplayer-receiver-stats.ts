export interface MultiplayerPacketLossStats {
  totalReceived: number;
  totalLost: number;
  totalPercent: number | null;
}

function lossPercent(received: number, lost: number): number | null {
  const sent = received + lost;
  return sent > 0 ? Math.round((lost / sent) * 10_000) / 100 : null;
}

export function updateMultiplayerPacketLossStats(
  packetsReceived: number,
  packetsLost: number
): MultiplayerPacketLossStats {
  return {
    totalReceived: packetsReceived,
    totalLost: packetsLost,
    totalPercent: lossPercent(packetsReceived, packetsLost)
  };
}
