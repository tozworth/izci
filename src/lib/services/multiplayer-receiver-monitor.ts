import type { PeerConnection, MultiplayerSessionState } from './multiplayer-types';
import { logDebug } from '$lib/logging/api';
import {
  updateReceivedBitrateWindow,
  type ReceivedByteSample
} from './multiplayer-receiver-bitrate';
import { updateMultiplayerPacketLossStats } from './multiplayer-receiver-stats';

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
  let lastDebugSampleAt = 0;

  function clear(): void {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    samples = [];
  }

  function start(peer: PeerConnection): void {
    clear();

    const sample = async () => {
      if (sampling || !isActivePeer(peer) || getState().mode !== 'client') return;
      sampling = true;
      try {
        const stats = await peer.pc.getStats();
        let bytesReceived = 0;
        let transportBytesReceived: number | null = null;
        let foundAudio = false;
        let packetsReceived = 0;
        let packetsLost = 0;
        let jitterMs: number | null = null;
        let jitterBufferDelayMs: number | null = null;
        let jitterBufferTargetDelayMs: number | null = null;
        let concealedSamples: number | null = null;
        let concealmentEvents: number | null = null;
        let insertedSamplesForDeceleration: number | null = null;
        let removedSamplesForAcceleration: number | null = null;
        let codec: string | null = null;
        let codecId: string | null = null;
        let roundTripTimeMs: number | null = null;
        stats.forEach((report) => {
          if (report.type === 'transport') {
            const transport = report as RTCTransportStats & { bytesReceived?: number };
            if (typeof transport.bytesReceived === 'number') {
              transportBytesReceived = transport.bytesReceived;
            }
            return;
          }
          if (report.type === 'inbound-rtp') {
            const inbound = report as RTCInboundRtpStreamStats & { mediaType?: string };
            if ((inbound.kind ?? inbound.mediaType) !== 'audio') return;
            if (typeof inbound.bytesReceived === 'number') bytesReceived += inbound.bytesReceived;
            if (typeof inbound.packetsReceived === 'number') packetsReceived += inbound.packetsReceived;
            if (typeof inbound.packetsLost === 'number') packetsLost += Math.max(0, inbound.packetsLost);
            if (typeof inbound.jitter === 'number') jitterMs = inbound.jitter * 1_000;
            const detailed = inbound as RTCInboundRtpStreamStats & {
              jitterBufferDelay?: number;
              jitterBufferTargetDelay?: number;
              jitterBufferEmittedCount?: number;
              concealedSamples?: number;
              concealmentEvents?: number;
              insertedSamplesForDeceleration?: number;
              removedSamplesForAcceleration?: number;
            };
            if (typeof detailed.jitterBufferEmittedCount === 'number'
              && detailed.jitterBufferEmittedCount > 0) {
              if (typeof detailed.jitterBufferDelay === 'number') {
                jitterBufferDelayMs = detailed.jitterBufferDelay
                  / detailed.jitterBufferEmittedCount * 1_000;
              }
              if (typeof detailed.jitterBufferTargetDelay === 'number') {
                jitterBufferTargetDelayMs = detailed.jitterBufferTargetDelay
                  / detailed.jitterBufferEmittedCount * 1_000;
              }
            }
            concealedSamples = finiteCounter(detailed.concealedSamples);
            concealmentEvents = finiteCounter(detailed.concealmentEvents);
            insertedSamplesForDeceleration = finiteCounter(detailed.insertedSamplesForDeceleration);
            removedSamplesForAcceleration = finiteCounter(detailed.removedSamplesForAcceleration);
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
        const loss = updateMultiplayerPacketLossStats(packetsReceived, packetsLost);
        const totalBytesReceived = transportBytesReceived ?? bytesReceived;
        publish({
          connectionStats: {
            packetsReceived: loss.totalReceived,
            packetsLost: loss.totalLost,
            packetLossPercent: loss.totalPercent,
            bytesReceived: totalBytesReceived,
            jitterMs: jitterMs === null ? null : Math.round(jitterMs * 10) / 10,
            jitterBufferDelayMs: roundedTenth(jitterBufferDelayMs),
            jitterBufferTargetDelayMs: roundedTenth(jitterBufferTargetDelayMs),
            concealedSamples,
            concealmentEvents,
            insertedSamplesForDeceleration,
            removedSamplesForAcceleration,
            roundTripTimeMs: roundTripTimeMs === null ? null : Math.round(roundTripTimeMs),
            codec
          }
        });
        const now = performance.now();
        if (now - lastDebugSampleAt >= 5_000) {
          lastDebugSampleAt = now;
          const receiver = peer.pc.getReceivers().find(({ track }) => track.kind === 'audio');
          logDebug('multiplayer', 'Receiver playout sample', {
            generationId: getState().remoteDelivery.generationId,
            delivery: getState().remoteDelivery.mode,
            trackId: receiver?.track.id ?? null,
            trackMuted: receiver?.track.muted ?? null,
            trackState: receiver?.track.readyState ?? null,
            jitterBufferTarget: receiver && 'jitterBufferTarget' in receiver
              ? receiver.jitterBufferTarget
              : null,
            bitrateKbps: next.averageKbps,
            packetsReceived: loss.totalReceived,
            packetsLost: loss.totalLost,
            bytesReceived: totalBytesReceived,
            jitterMs: roundedTenth(jitterMs),
            jitterBufferDelayMs: roundedTenth(jitterBufferDelayMs),
            jitterBufferTargetDelayMs: roundedTenth(jitterBufferTargetDelayMs),
            concealedSamples,
            concealmentEvents,
            insertedSamplesForDeceleration,
            removedSamplesForAcceleration,
            roundTripTimeMs
          });
        }
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

function finiteCounter(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function roundedTenth(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10;
}
