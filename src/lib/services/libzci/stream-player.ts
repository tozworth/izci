import { audioBusService } from '$lib/services/audio-bus';
import { logInfo, logWarning } from '$lib/services/logging';
import { applyReplayGain } from '$lib/services/volume';
import type { PlaybackSnapshot, ReplayGainMetadata, ReplayGainMode, TrackItem, TrackMetadata } from '$lib/types';
import {
  type CoreFacts,
  type WorkerSnapshotMessage
} from './protocol';
import { type EngineLink, createLibzciEngineLink } from './runtime';
import { mapCoreSnapshot } from './snapshot';

type SnapshotHandler = (snapshot: Partial<PlaybackSnapshot>) => void;
type MetadataHandler = (metadata: TrackMetadata) => void;
type EndHandler = () => void;

interface StreamLoadOptions {
  autoPlay?: boolean;
  initialPosition?: number;
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
 * Engine bootstrapping lives in the shared `./runtime` link.
 */
export class LibzciStreamPlayerService {
  #link: EngineLink | null = null;
  #linkReady: Promise<EngineLink> | null = null;
  #transitionGain = 1;
  #replayGain: ReplayGainMetadata | undefined;
  #replayGainMode: ReplayGainMode = 'track';
  #replayGainPreampDb = 0;
  #metadataPublished = false;
  #ended = false;
  #destroyed = false;
  #loggedRateGap = false;
  #track: TrackItem | null = null;

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
      const link = await this.#ensureLink();
      await link.request({
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
    if (this.#link) {
      audioBusService.setSourceReplayGain(
        this.#link.node,
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
    if (this.#link) audioBusService.setSourceGain(this.#link.node, this.#transitionGain, durationSeconds);
  }

  destroy(): void {
    this.#destroyed = true;
    this.#linkReady = null;
    const link = this.#link;
    this.#link = null;
    if (link) {
      audioBusService.disconnect(link.node);
      link.close();
    }
  }

  async #ensureLink(): Promise<EngineLink> {
    if (this.#link) return this.#link;
    if (!this.#linkReady) {
      this.#linkReady = (async () => {
        const context = audioBusService.context;
        const link = await createLibzciEngineLink(
          context,
          {
            onSnapshot: (message) => this.#receiveSnapshot(message),
            onError: (error) => this.#reportError(error)
          },
          'stream playback'
        );
        if (this.#destroyed) {
          audioBusService.disconnect(link.node);
          link.close();
          throw new Error('libzci playback closed during startup');
        }
        this.#link = link;
        link.notifyContextState();
        audioBusService.connectAudioNode(link.node);
        audioBusService.setSourceGain(link.node, this.#transitionGain);
        audioBusService.setSourceReplayGain(link.node, applyReplayGain(1, this.#replayGain, this.#replayGainMode, this.#replayGainPreampDb));
        return link;
      })();
      try {
        await this.#linkReady;
      } catch (error) {
        this.#linkReady = null;
        throw error;
      }
    }
    return this.#linkReady;
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
    const link = await this.#ensureLink();
    await link.request({ type: 'command', request: crypto.randomUUID(), kind, value });
  }

  #reportError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.onSnapshot({ state: 'error', error: message });
  }
}
