import workletUrl from './playback.worklet.ts?worker&url';
import audioWasm from '../../../../libzci/consumers/crude-pwa/src/generated/libzci_audio_web.wasm?url';
import { audioBusService } from '$lib/services/audio-bus';
import { logInfo, logWarning } from '$lib/services/logging';
import { applyReplayGain } from '$lib/services/volume';
import type { PlaybackSnapshot, ReplayGainMetadata, ReplayGainMode, TrackItem, TrackMetadata } from '$lib/types';
import {
  type CoreFacts,
  type WorkerMessage,
  type WorkerRequest,
  type WorkerSnapshotMessage
} from './protocol';
import { mapCoreSnapshot } from './snapshot';

type SnapshotHandler = (snapshot: Partial<PlaybackSnapshot>) => void;
type MetadataHandler = (metadata: TrackMetadata) => void;
type EndHandler = () => void;

interface StreamLoadOptions {
  autoPlay?: boolean;
  initialPosition?: number;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

const workletLoads = new WeakMap<AudioContext, Promise<void>>();

function ensureWorklet(context: AudioContext): Promise<void> {
  let pending = workletLoads.get(context);
  if (!pending) {
    pending = context.audioWorklet.addModule(workletUrl).catch((error) => {
      workletLoads.delete(context);
      throw error;
    });
    workletLoads.set(context, pending);
  }
  return pending;
}

function normalizeCommentKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, '').toUpperCase();
}

function metadataFromFacts(facts: CoreFacts, track: TrackItem, duration: number): TrackMetadata {
  const metadata: TrackMetadata = {};
  for (const [rawKey, value] of facts.comments) {
    if (!value.trim()) continue;
    switch (normalizeCommentKey(rawKey)) {
      case 'TITLE':
        metadata.title ??= value;
        break;
      case 'ARTIST':
        metadata.artist ??= value;
        break;
      case 'ALBUM':
        metadata.album ??= value;
        break;
      case 'ALBUMARTIST':
        metadata.albumArtist ??= value;
        break;
      case 'GENRE':
        metadata.genre ??= value;
        break;
      case 'DATE':
      case 'YEAR':
        metadata.year ??= value;
        break;
      case 'TRACKNUMBER':
        metadata.trackNumber ??= value;
        break;
      case 'DISCNUMBER':
        metadata.discNumber ??= value;
        break;
      case 'COMPOSER':
        metadata.composer ??= value;
        break;
      case 'REPLAYGAINTRACKGAIN': {
        const parsed = Number(value.replace(/db/i, '').trim());
        if (Number.isFinite(parsed)) metadata.replayGain = { ...metadata.replayGain, trackGainDb: parsed };
        break;
      }
      case 'REPLAYGAINALBUMGAIN': {
        const parsed = Number(value.replace(/db/i, '').trim());
        if (Number.isFinite(parsed)) metadata.replayGain = { ...metadata.replayGain, albumGainDb: parsed };
        break;
      }
      case 'REPLAYGAINTRACKPEAK': {
        const parsed = Number(value.trim());
        if (Number.isFinite(parsed)) metadata.replayGain = { ...metadata.replayGain, trackPeak: parsed };
        break;
      }
      case 'REPLAYGAINALBUMPEAK': {
        const parsed = Number(value.trim());
        if (Number.isFinite(parsed)) metadata.replayGain = { ...metadata.replayGain, albumPeak: parsed };
        break;
      }
      default:
        break;
    }
  }
  if (duration > 0) {
    metadata.duration = duration;
    metadata.bitrate = Math.round((track.size * 8) / duration / 1000);
  }
  metadata.sampleRate = facts.rate;
  metadata.channels = facts.channels;
  return metadata;
}

/**
 * Production Svelte binding for ordinary stream playback. libzci owns
 * classification, provider selection, transport, conversion and audible
 * position. This adapter owns only browser activation, worklet attachment and
 * conversion of core observations into the existing playback facade.
 */
export class LibzciStreamPlayerService {
  #worker: Worker | null = null;
  #node: AudioWorkletNode | null = null;
  #runtimeReady: Promise<void> | null = null;
  #pending = new Map<string, PendingRequest>();
  #transitionGain = 1;
  #replayGain: ReplayGainMetadata | undefined;
  #replayGainMode: ReplayGainMode = 'track';
  #replayGainPreampDb = 0;
  #metadataPublished = false;
  #ended = false;
  #destroyed = false;
  #loggedRateGap = false;
  #track: TrackItem | null = null;
  #context: AudioContext | null = null;
  #onContextStateChange: (() => void) | null = null;

  constructor(
    private readonly onSnapshot: SnapshotHandler,
    private readonly onMetadata: MetadataHandler,
    private readonly onEnded: EndHandler
  ) {}

  async load(track: TrackItem, options: StreamLoadOptions = {}): Promise<void> {
    if (!track.file) throw new Error('Expected a File for streamable audio.');
    this.#destroyed = false;
    this.#track = track;
    this.#metadataPublished = false;
    this.#ended = false;
    const initialPosition = Math.max(options.initialPosition ?? 0, 0);
    this.onSnapshot({
      backend: 'stream',
      state: 'loading',
      currentTime: initialPosition,
      duration: track.metadata?.duration ?? 0,
      error: undefined
    });
    logInfo('playback', 'libzci stream load started', { id: track.id, name: track.name });
    try {
      await this.#ensureRuntime();
      await this.#request({
        type: 'load',
        request: crypto.randomUUID(),
        file: track.file,
        startSeconds: initialPosition,
        subsong: null,
        autoPlay: options.autoPlay === true,
        replayGain: {
          mode: this.#replayGainMode,
          fallback: true,
          preamp_db: this.#replayGainPreampDb,
          missing_gain_db: 0,
          r128_target_lufs: -18,
          prevent_clipping: true
        }
      });
      logInfo('playback', 'libzci stream loaded', { id: track.id, name: track.name });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.onSnapshot({ state: 'error', error: message });
      throw error;
    }
  }

  play(): void {
    void this.#command('play').catch((error) => this.#reportError(error));
  }

  pause(): void {
    void this.#command('pause').catch((error) => this.#reportError(error));
  }

  seek(seconds: number): void {
    const position = Math.max(seconds, 0);
    this.onSnapshot({ currentTime: position });
    void this.#command('seek', position).catch((error) => this.#reportError(error));
  }

  setVolume(
    _volume: number,
    _logarithmicVolume: boolean,
    replayGain: ReplayGainMetadata | undefined = this.#replayGain,
    replayGainMode: ReplayGainMode = this.#replayGainMode,
    replayGainPreampDb: number = this.#replayGainPreampDb
  ): void {
    // Master volume and logarithmic slider shaping remain on the shared bus.
    // ReplayGain is the shell-side bridge until metadata normalization moves
    // fully into the core in the queue/library slice.
    this.#replayGain = replayGain;
    this.#replayGainMode = replayGainMode;
    this.#replayGainPreampDb = replayGainPreampDb;
    if (this.#node) {
      audioBusService.setSourceReplayGain(
        this.#node,
        applyReplayGain(1, replayGain, replayGainMode, replayGainPreampDb)
      );
    }
  }

  setPlaybackRate(playbackRate: number, trueSpeed: boolean): void {
    if (playbackRate === 1) return;
    if (!this.#loggedRateGap) {
      this.#loggedRateGap = true;
      logWarning('playback', 'libzci stream speed is not adopted yet', { playbackRate, trueSpeed });
    }
  }

  setTransitionGain(gain: number, durationSeconds = 0): void {
    this.#transitionGain = Number.isFinite(gain) ? Math.max(gain, 0) : 1;
    if (this.#node) audioBusService.setSourceGain(this.#node, this.#transitionGain, durationSeconds);
  }

  destroy(): void {
    this.#destroyed = true;
    for (const pending of this.#pending.values()) pending.reject(new Error('libzci playback closed'));
    this.#pending.clear();
    const worker = this.#worker;
    this.#worker = null;
    if (worker) {
      worker.postMessage({ type: 'close' } satisfies WorkerRequest);
      // Give the worker one task turn to tell the worklet to release renderer
      // memory before terminating the shared port pair.
      setTimeout(() => worker.terminate(), 50);
    }
    this.#runtimeReady = null;
    if (this.#context && this.#onContextStateChange) this.#context.removeEventListener('statechange', this.#onContextStateChange);
    this.#context = null;
    this.#onContextStateChange = null;
    if (this.#node) audioBusService.disconnect(this.#node);
    this.#node = null;
  }

  async #ensureRuntime(): Promise<void> {
    if (this.#runtimeReady) return this.#runtimeReady;
    this.#runtimeReady = (async () => {
      const context = audioBusService.context;
      await ensureWorklet(context);
      const response = await fetch(audioWasm);
      if (!response.ok) throw new Error(`libzci audio WASM HTTP ${response.status}`);
      const module = await WebAssembly.compileStreaming(response);
      const worker = new Worker(new URL('./playback.worker.ts', import.meta.url), { type: 'module' });
      const node = new AudioWorkletNode(context, 'libzci-output', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: { module }
      });
      const decode = new MessageChannel();
      const control = new MessageChannel();
      let resolveReady!: () => void;
      let rejectReady!: (error: Error) => void;
      const ready = new Promise<void>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
      });
      let readySettled = false;
      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        const message = event.data;
        if (message.type === 'ready') {
          readySettled = true;
          resolveReady();
          return;
        }
        if (message.type === 'result') {
          const pending = this.#pending.get(message.request);
          if (!pending) return;
          this.#pending.delete(message.request);
          if (message.error) pending.reject(new Error(message.error));
          else pending.resolve(message.value);
          return;
        }
        if (message.type === 'snapshot') {
          this.#receiveSnapshot(message);
          return;
        }
        if (message.type === 'error') {
          if (!readySettled) {
            readySettled = true;
            rejectReady(new Error(message.detail));
          }
          this.#reportError(new Error(message.detail));
        }
      };
      worker.onerror = (event) => {
        const error = new Error(event.message || 'libzci playback worker failed');
        if (!readySettled) {
          readySettled = true;
          rejectReady(error);
        }
        for (const pending of this.#pending.values()) pending.reject(error);
        this.#pending.clear();
        this.#reportError(error);
      };
      node.onprocessorerror = () => this.#reportError(new Error('libzci audio processor failed'));
      node.port.postMessage({ type: 'attach', control: control.port2, decode: decode.port2 }, [control.port2, decode.port2]);
      worker.postMessage({
        type: 'init',
        rate: context.sampleRate,
        latency: (context.baseLatency + (context.outputLatency ?? 0)) * context.sampleRate,
        control: control.port1,
        decode: decode.port1
      } satisfies WorkerRequest, [control.port1, decode.port1]);
      await ready;
      if (this.#destroyed) {
        worker.terminate();
        throw new Error('libzci playback closed during startup');
      }
      this.#worker = worker;
      this.#context = context;
      this.#onContextStateChange = () => worker.postMessage({ type: 'context', state: context.state } satisfies WorkerRequest);
      context.addEventListener('statechange', this.#onContextStateChange);
      this.#onContextStateChange();
      this.#node = node;
      audioBusService.connectAudioNode(node);
      audioBusService.setSourceGain(node, this.#transitionGain);
      audioBusService.setSourceReplayGain(node, applyReplayGain(1, this.#replayGain, this.#replayGainMode, this.#replayGainPreampDb));
    })();
    try {
      await this.#runtimeReady;
    } catch (error) {
      this.#runtimeReady = null;
      throw error;
    }
  }

  #receiveSnapshot(message: WorkerSnapshotMessage): void {
    if (this.#destroyed) return;
    const mapped = mapCoreSnapshot(message.core);
    this.onSnapshot(mapped);
    if (message.facts && this.#track && !this.#metadataPublished) {
      this.#metadataPublished = true;
      this.onMetadata(metadataFromFacts(message.facts, this.#track, mapped.duration ?? 0));
    }
    if (message.ended && !this.#ended) {
      this.#ended = true;
      this.onEnded();
    }
  }

  async #command(kind: string, value = 0): Promise<void> {
    await this.#ensureRuntime();
    await this.#request({ type: 'command', request: crypto.randomUUID(), kind, value });
  }

  #request(request: Extract<WorkerRequest, { request: string }>): Promise<unknown> {
    if (!this.#worker) return Promise.reject(new Error('libzci playback is not initialized'));

    return new Promise((resolve, reject) => {
      this.#pending.set(request.request, { resolve, reject });
      this.#worker!.postMessage(request);
    });
  }

  #reportError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.onSnapshot({ state: 'error', error: message });
  }
}
