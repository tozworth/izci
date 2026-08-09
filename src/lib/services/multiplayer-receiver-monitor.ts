import type { PeerConnection, MultiplayerSessionState } from './multiplayer-types';
import {
  updateReceivedBitrateWindow,
  type ReceivedByteSample
} from './multiplayer-receiver-bitrate';
import {
  updateMultiplayerPacketLossStats,
  type MultiplayerReceiverCounterSample
} from './multiplayer-receiver-stats';

export const RECEIVER_BITRATE_SAMPLE_INTERVAL_MS = 1_000;

export interface ReceiverBitrateMonitorOptions {
  getState: () => MultiplayerSessionState;
  publish: (patch: Partial<MultiplayerSessionState>) => void;
  isActivePeer: (peer: PeerConnection) => boolean;
}

export function createReceiverBitrateMonitor({
  getState,
  publish,
  isActivePeer
}: ReceiverBitrateMonitorOptions): {
  start(peer: PeerConnection): void;
  clear(): void;
} {
  let timer: number | null = null;
  let sampling = false;
  let samples: ReceivedByteSample[] = [];
  let counterSamples: MultiplayerReceiverCounterSample[] = [];

  function clear(): void {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    samples = [];
    counterSamples = [];
  }

  function start(peer: PeerConnection): void {
    clear();

    const sample = async () => {
      if (sampling || !isActivePeer(peer) || getState().mode !== 'client') return;
      sampling = true;
      try {
        const stats = await peer.pc.getStats();
        let bytesReceived = 0;
        let foundAudio = false;
        let packetsReceived = 0;
        let packetsLost = 0;
        let jitterMs: number | null = null;
        let codec: string | null = null;
        let codecId: string | null = null;
        let roundTripTimeMs: number | null = null;
        stats.forEach((report) => {
          if (report.type === 'inbound-rtp') {
            const inbound = report as RTCInboundRtpStreamStats & { mediaType?: string };
            if ((inbound.kind ?? inbound.mediaType) !== 'audio') return;
            if (typeof inbound.bytesReceived === 'number') bytesReceived += inbound.bytesReceived;
            if (typeof inbound.packetsReceived === 'number') packetsReceived += inbound.packetsReceived;
            if (typeof inbound.packetsLost === 'number') packetsLost += Math.max(0, inbound.packetsLost);
            if (typeof inbound.jitter === 'number') jitterMs = inbound.jitter * 1_000;
            if (typeof inbound.codecId === 'string') codecId = inbound.codecId;
            foundAudio = true;
            return;
          }
          if (report.type === 'candidate-pair') {
            const pair = report as RTCIceCandidatePairStats;
            if (pair.state === 'succeeded' && pair.nominated
              && typeof pair.currentRoundTripTime === 'number') {
              roundTripTimeMs = pair.currentRoundTripTime * 1_000;
            }
          }
        });
        if (!foundAudio || !isActivePeer(peer)) return;
        if (codecId) {
          const codecReport = stats.get(codecId) as {
            mimeType?: string;
            clockRate?: number;
          } | undefined;
          if (codecReport?.mimeType) {
            codec = codecReport.mimeType.replace(/^audio\//i, '');
            if (typeof codecReport.clockRate === 'number') codec += ` ${Math.round(codecReport.clockRate / 1_000)} kHz`;
          }
        }
        const next = updateReceivedBitrateWindow(samples, {
          timestamp: performance.now(),
          bytesReceived
        });
        samples = next.samples;
        const loss = updateMultiplayerPacketLossStats(counterSamples, {
          timestamp: performance.now(),
          packetsReceived,
          packetsLost
        });
        counterSamples = loss.samples;
        publish({
          connectionStats: {
            packetsReceived: loss.totalReceived,
            packetsLost: loss.totalLost,
            packetLossPercent: loss.totalPercent,
            recentPacketsReceived: loss.recentReceived,
            recentPacketsLost: loss.recentLost,
            recentPacketLossPercent: loss.recentPercent,
            jitterMs: jitterMs === null ? null : Math.round(jitterMs * 10) / 10,
            roundTripTimeMs: roundTripTimeMs === null ? null : Math.round(roundTripTimeMs),
            codec
          }
        });
        const state = getState();
        if (state.audioStatus === 'playing'
          && next.averageKbps !== state.averageAudioBitrateKbps) {
          publish({ averageAudioBitrateKbps: next.averageKbps });
        }
      } catch {
        // Receiver stats are optional; audio playback continues without a bitrate readout.
      } finally {
        sampling = false;
      }
    };

    void sample();
    timer = window.setInterval(
      () => void sample(),
      RECEIVER_BITRATE_SAMPLE_INTERVAL_MS
    );
  }

  return { start, clear };
}
