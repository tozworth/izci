/// <reference lib="webworker" />

import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Output,
  Quality,
  WebMOutputFormat,
  type AudioCodec
} from 'mediabunny';
import { streamModulePcm } from './module-render-core';
import { sliceBytes, splitWebm } from './multiplayer-webm';

export interface MultiplayerRenderRequest {
  type: 'render';
  name: string;
  extension: string;
  kind: 'stream' | 'module';
  file: File | null;
  moduleBytes: ArrayBuffer | null;
  bitrateKbps: number;
  hivelyWasmUrl: string;
  libopenmptUrl: string;
}

export interface MultiplayerRenderResult {
  type: 'complete';
  init: ArrayBuffer;
  clusters: ArrayBuffer[];
  clusterTimeMs: number[];
  clusterDurationMs: number;
  durationMs: number;
  bitrateKbps: number;
}

type MultiplayerRenderResponse =
  | { type: 'progress'; stage: 'decode' | 'render' | 'encode'; progress: number | null }
  | MultiplayerRenderResult
  | { type: 'error'; message: string };

const worker = self as unknown as DedicatedWorkerGlobalScope;

function post(message: MultiplayerRenderResponse, transfer?: Transferable[]): void {
  worker.postMessage(message, transfer ?? []);
}

const WEBM_CLUSTER_DURATION_MS = 1_000;
const RENDER_SAMPLE_RATE = 48_000;

function createWebmFormat(): WebMOutputFormat {
  // minimumClusterDuration is expressed in SECONDS by mediabunny, not ms.
  return new WebMOutputFormat({ minimumClusterDuration: WEBM_CLUSTER_DURATION_MS / 1_000 });
}

function createOpusAudioOptions(bitrateKbps: number): Parameters<typeof Conversion.init>[0]['audio'] {
  return {
    codec: 'opus' as AudioCodec,
    quality: new Quality({ bitrate: Math.round(bitrateKbps * 1_000), bitrateMode: 'variable' }),
    numberOfChannels: 2,
    sampleRate: RENDER_SAMPLE_RATE,
    sampleFormat: 'f32',
    forceTranscode: true
  };
}

function toWebmResult(webm: Uint8Array, bitrateKbps: number): MultiplayerRenderResult {
  const split = splitWebm(webm);
  if (!split) throw new Error('The renderer produced an unreadable WebM stream.');
  const clusters: ArrayBuffer[] = [];
  const clusterTimeMs: number[] = [];
  for (const cluster of split.clusters) {
    clusters.push(sliceBytes(webm, cluster.start, cluster.end));
    clusterTimeMs.push(cluster.timeMs);
  }
  if (clusters.length === 0) throw new Error('The renderer produced no audio clusters.');
  return {
    type: 'complete',
    init: sliceBytes(webm, split.initStart, split.initEnd),
    clusters,
    clusterTimeMs,
    clusterDurationMs: WEBM_CLUSTER_DURATION_MS,
    durationMs: split.durationMs > 0 ? split.durationMs : clusterTimeMs[clusterTimeMs.length - 1] + WEBM_CLUSTER_DURATION_MS,
    bitrateKbps
  };
}

async function renderMediaFile(request: MultiplayerRenderRequest): Promise<MultiplayerRenderResult> {
  const target = new BufferTarget();
  const output = new Output({ format: createWebmFormat(), target });
  const input = new Input({ source: new BlobSource(request.file!), formats: ALL_FORMATS });
  try {
    const conversion = await Conversion.init({
      input,
      output,
      tracks: 'all',
      video: { discard: true },
      audio: createOpusAudioOptions(request.bitrateKbps),
      tags: {},
      showWarnings: false
    });
    if (!conversion.isValid) {
      const reason = conversion.discardedTracks[0]?.reason;
      throw new Error(reason
        ? `No usable audio tracks (${reason.replaceAll('_', ' ')})`
        : 'No usable audio tracks were found.');
    }
    conversion.onProgress = (progress) => post({
      type: 'progress',
      stage: 'encode',
      progress
    });
    await conversion.execute();
    if (!target.buffer) throw new Error('The rendered media buffer was not produced.');
    return toWebmResult(new Uint8Array(target.buffer), request.bitrateKbps);
  } finally {
    input.dispose();
  }
}

async function renderModule(request: MultiplayerRenderRequest): Promise<MultiplayerRenderResult> {
  post({ type: 'progress', stage: 'render', progress: 0 });
  const target = new BufferTarget();
  const output = new Output({ format: createWebmFormat(), target });
  const source = new AudioSampleSource({
    codec: 'opus',
    quality: new Quality({ bitrate: Math.round(request.bitrateKbps * 1_000), bitrateMode: 'variable' }),
    transform: {
      numberOfChannels: 2,
      sampleRate: RENDER_SAMPLE_RATE,
      sampleFormat: 'f32'
    }
  });
  output.addAudioTrack(source);

  await output.start();
  let frameCount = 0;
  try {
    frameCount = await streamModulePcm({
      type: 'render',
      extension: request.extension,
      module: request.moduleBytes!,
      hivelyWasmUrl: request.hivelyWasmUrl,
      libopenmptUrl: request.libopenmptUrl,
      sampleRate: RENDER_SAMPLE_RATE
    }, async ({ startFrame, left, right }) => {
      const length = Math.min(left.length, right.length);
      const interleaved = new Float32Array(length * 2);
      for (let frame = 0; frame < length; frame += 1) {
        interleaved[frame * 2] = left[frame] ?? 0;
        interleaved[frame * 2 + 1] = right[frame] ?? 0;
      }
      const sample = new AudioSample({
        data: interleaved,
        format: 'f32',
        numberOfChannels: 2,
        sampleRate: RENDER_SAMPLE_RATE,
        timestamp: startFrame / RENDER_SAMPLE_RATE
      });
      try {
        await source.add(sample);
      } finally {
        sample.close();
      }
    }, (progress) => {
      post({
        type: 'progress',
        stage: 'render',
        progress: progress.totalFrames > 0
          ? Math.min(progress.renderedFrames / progress.totalFrames, 1)
          : null
      });
    });
    if (frameCount === 0) throw new Error('The module produced no audio.');
    source.close();
    await output.finalize();
  } catch (error) {
    source.close();
    await output.cancel();
    throw error;
  }

  if (!target.buffer) throw new Error('The rendered module buffer was not produced.');
  return toWebmResult(new Uint8Array(target.buffer), request.bitrateKbps);
}

worker.onmessage = (event: MessageEvent<MultiplayerRenderRequest>) => {
  const request = event.data;
  if (request?.type !== 'render') return;
  void (request.kind === 'module' ? renderModule(request) : renderMediaFile(request))
    .then((result) => {
      const transfer: Transferable[] = [result.init, ...result.clusters];
      post(result, transfer);
    })
    .catch((error) => {
      post({
        type: 'error',
        message: error instanceof Error ? error.message : 'Render failed.'
      });
    });
};
