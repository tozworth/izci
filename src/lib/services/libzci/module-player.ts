import { audioBusService } from '$lib/services/audio-bus';
import { inspectHivelyPatterns } from '$lib/services/hively-pattern-inspect';
import { logInfo, logWarning } from '$lib/services/logging';
import { mediaSessionService } from '$lib/services/media-session';
import { moduleDecoder } from '$lib/services/openmpt/decoder';
import { getOpenMptRampingStrength } from '$lib/stores/module-playback-settings';
import type {
  ModulePatternSnapshot,
  ModulePatternSong,
  ModulePlaybackSettings,
  PlaybackSnapshot,
  TrackItem,
  TrackMetadata
} from '$lib/types';
import {
  type CoreFacts,
  type WorkerSnapshotMessage
} from './protocol';
import { type EngineLink, createLibzciEngineLink } from './runtime';
import { mapCoreSnapshot } from './snapshot';

type SnapshotHandler = (snapshot: Partial<PlaybackSnapshot>) => void;
type MetadataHandler = (metadata: TrackMetadata) => void;
type PatternHandler = (snapshot: Partial<ModulePatternSnapshot> | null) => void;
type EndHandler = () => void;

function normalizeCommentKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, '').toUpperCase();
}

function metadataFromModuleFacts(
  facts: CoreFacts,
  track: TrackItem,
  duration: number,
  isHively: boolean
): TrackMetadata {
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
      case 'TRACKER':
        metadata.trackerType ??= value;
        break;
      case 'TYPE':
        metadata.originalType ??= value;
        break;
      case 'MESSAGE':
        metadata.message ??= value;
        break;
      default:
        break;
    }
  }
  if (isHively) {
    // The libzci Hively provider reports only the song title; synthesize the
    // presentation facts the legacy worklet supplied so Track Details and the
    // inspector keep working without a second transport.
    metadata.trackerType ??= 'HivelyTracker';
    metadata.originalType ??= track.extension.toLowerCase();
  }
  const subsongs = typeof facts.capabilities['subsongs'] === 'number'
    ? Math.max(1, Math.trunc(facts.capabilities['subsongs'] as number))
    : 1;
  const channels = typeof facts.capabilities['channels'] === 'number'
    ? Math.max(1, Math.trunc(facts.capabilities['channels'] as number))
    : undefined;
  metadata.subsongs = subsongs;
  if (channels !== undefined) metadata.channels = channels;
  if (duration > 0) {
    metadata.duration = duration;
    metadata.bitrate = Math.round((track.size * 8) / Math.max(duration, 0.01) / 1000);
  }
  metadata.sampleRate = facts.rate;
  return metadata;
}

const HIVELY_EXTENSIONS = new Set(['ahx', 'hvl']);

/**
 * Production Svelte binding for tracker modules. libzci owns
 * classification, provider selection, transport, conversion and audible
 * position for both OpenMPT modules and Hively (AHX/HVL) modules through the
 * shared modules-reference provider. Full OpenMPT pattern songs still come
 * from the legacy inspection worker (no audio player); Hively pattern songs
 * come from output-free replay-core inspection. Live order/pattern/row comes
 * from core observations in both cases. Engine bootstrapping lives in the
 * shared `./runtime` link.
 */
export class LibzciModulePlayerService {
  #link: EngineLink | null = null;
  #linkReady: Promise<EngineLink> | null = null;
  #transitionGain = 1;
  #metadataPublished = false;
  #ended = false;
  #destroyed = false;
  #track: TrackItem | null = null;
  #loadToken = 0;
  #patternJob: AbortController | undefined;
  #patternSong: ModulePatternSong | null = null;
  #subsong = 0;
  #subsongCount = 1;
  #channelMutes: boolean[] = [];
  #settingsApplied: ModulePlaybackSettings | null = null;
  #isHively = false;
  #loggedSeparationGap = false;
  #loggedRepeatGap = false;
  #loggedHivelyRateGap = false;
  #loggedHivelyRepeatGap = false;

  constructor(
    private readonly onSnapshot: SnapshotHandler,
    private readonly onMetadata: MetadataHandler,
    private readonly onPattern: PatternHandler,
    private readonly onEnded: EndHandler
  ) {}

  async load(track: TrackItem): Promise<void> {
    if (!track.file) throw new Error('Expected a File for tracker module playback.');
    this.#resetForLoad();
    const token = ++this.#loadToken;
    this.#track = track;
    this.#isHively = HIVELY_EXTENSIONS.has(track.extension.toLowerCase());
    this.#subsong = Number.isFinite(track.subsong) ? Math.max(0, Math.trunc(track.subsong!)) : 0;
    this.#subsongCount = Math.max(1, track.metadata?.subsongs ?? 1);
    this.onSnapshot({
      backend: 'module',
      state: 'loading',
      currentTime: 0,
      duration: track.metadata?.duration ?? 0,
      subsong: this.#subsong,
      subsongCount: this.#subsongCount,
      error: undefined
    });
    logInfo('playback', 'libzci module load started', { id: track.id, name: track.name, subsong: this.#subsong, hively: this.#isHively });
    try {
      const link = await this.#ensureLink();
      if (token !== this.#loadToken) return;
      await link.request({
        type: 'load',
        request: crypto.randomUUID(),
        file: track.file,
        startSeconds: 0,
        subsong: this.#subsong,
        autoPlay: false,
        replayGain: {
          mode: 'off',
          fallback: false,
          preamp_db: 0,
          missing_gain_db: 0,
          r128_target_lufs: -18,
          prevent_clipping: false
        }
      });
      if (token !== this.#loadToken) return;
      await this.#applyStoredSettings();
      if (token !== this.#loadToken) return;
      this.#loadPatterns(token);
      mediaSessionService.activateTransportAnchor();
      mediaSessionService.pauseTransportAnchor();
      logInfo('playback', 'libzci module loaded', { id: track.id, name: track.name, hively: this.#isHively });
    } catch (error) {
      if (token !== this.#loadToken) return;
      const message = error instanceof Error ? error.message : String(error);
      this.onSnapshot({ state: 'error', error: message });
      throw error;
    }
  }

  play(): void {
    if (this.#destroyed) return;
    void this.#command('play').catch((error) => this.#reportError(error));
    mediaSessionService.playTransportAnchor();
  }

  pause(): void {
    if (this.#destroyed) return;
    void this.#command('pause').catch((error) => this.#reportError(error));
    mediaSessionService.pauseTransportAnchor();
  }

  seek(seconds: number): void {
    if (this.#destroyed) return;
    const position = Math.max(seconds, 0);
    this.onSnapshot({ currentTime: position });
    void this.#command('seek', position).catch((error) => this.#reportError(error));
  }

  stop(options: { silent?: boolean } = {}): void {
    this.#loadToken += 1;
    this.#patternJob?.abort();
    this.#patternJob = undefined;
    this.#patternSong = null;
    this.#subsong = 0;
    this.#subsongCount = 1;
    this.#channelMutes = [];
    this.onPattern(null);
    this.#teardownLink();
    mediaSessionService.deactivateTransportAnchor();
    if (!options.silent) this.onSnapshot({ state: 'paused', currentTime: 0, error: undefined });
  }

  stepSubsong(direction: -1 | 1): number | null {
    if (this.#destroyed || this.#subsongCount <= 1) return null;
    this.#subsong = (this.#subsong + direction + this.#subsongCount) % this.#subsongCount;
    this.#patternSong = null;
    this.onPattern({ song: null, order: 0, pattern: 0, row: 0 });
    this.onSnapshot({ currentTime: 0, duration: 0, subsong: this.#subsong, error: undefined });
    void this.#command('subsong', this.#subsong).catch((error) => this.#reportError(error));
    const token = this.#loadToken;
    this.#loadPatterns(token);
    return this.#subsong;
  }

  async applySettings(settings: ModulePlaybackSettings): Promise<void> {
    this.#settingsApplied = settings;
    if (!this.#link) return;
    const commands: Array<[string, number]> = [];
    if (Number.isFinite(settings.interpolationFilter)) {
      commands.push(['interpolation', settings.interpolationFilter]);
    }
    if (this.#isHively) {
      // The shared Hively provider supports interpolation, subsongs and
      // channel mutes. Ramping, tempo/pitch factors and loop counts remain
      // legacy-worklet behavior with no core equivalent in this slice.
      if (settings.tempoFactor !== 1 || settings.pitchFactor !== 1) {
        if (!this.#loggedHivelyRateGap) {
          this.#loggedHivelyRateGap = true;
          logWarning('playback', 'libzci Hively tempo/pitch is not adopted yet', {
            tempoFactor: settings.tempoFactor,
            pitchFactor: settings.pitchFactor
          });
        }
      }
      let loops = Math.trunc(settings.repeatCount);
      if (!Number.isFinite(loops)) loops = 0;
      if (loops !== 0 && !this.#loggedHivelyRepeatGap) {
        this.#loggedHivelyRepeatGap = true;
        logWarning('playback', 'libzci Hively repeat is not adopted yet', { repeatCount: settings.repeatCount });
      }
    } else {
      commands.push(['ramping', getOpenMptRampingStrength(settings.ramping)]);
      if (Number.isFinite(settings.tempoFactor)) commands.push(['speed', settings.tempoFactor]);
      if (Number.isFinite(settings.pitchFactor)) commands.push(['pitch', settings.pitchFactor]);
      let loops = Math.trunc(settings.repeatCount);
      if (!Number.isFinite(loops)) loops = 0;
      if (loops < 0) {
        loops = 16;
        if (!this.#loggedRepeatGap) {
          this.#loggedRepeatGap = true;
          logWarning('playback', 'libzci module infinite repeat mapped to 16 loops', { repeatCount: settings.repeatCount });
        }
      }
      commands.push(['loops', Math.min(Math.max(loops, 0), 16)]);
    }
    for (const [kind, value] of commands) {
      try {
        await this.#command(kind, value);
      } catch (error) {
        // Capability-gated controls (e.g. pitch on some modules) are expected
        // to reject; transport remains usable.
        logWarning('playback', 'libzci module control rejected', { kind, value, error: String(error) });
      }
    }
    if ((settings.stereoSeparation !== 100 && settings.stereoSeparation !== 50) || settings.panStrength !== 100) {
      if (!this.#loggedSeparationGap) {
        this.#loggedSeparationGap = true;
        logWarning('playback', 'libzci module stereo separation is not adopted yet', {
          stereoSeparation: settings.stereoSeparation,
          panStrength: settings.panStrength
        });
      }
    }
    if (this.#channelMutes.length) {
      this.setChannelMutes(this.#channelMutes);
    }
  }

  setTransitionGain(gain: number, durationSeconds = 0): void {
    this.#transitionGain = Number.isFinite(gain) ? Math.max(gain, 0) : 1;
    if (this.#link) audioBusService.setSourceGain(this.#link.node, this.#transitionGain, durationSeconds);
  }

  setChannelMutes(muted: boolean[]): void {
    this.#channelMutes = [...muted];
    if (!this.#link) return;
    muted.forEach((mute, channel) => {
      const kind = mute ? 'channel-mute' : 'channel-unmute';
      void this.#command(kind, channel).catch((error) => {
        logWarning('playback', 'libzci module channel mute rejected', { channel, mute, error: String(error) });
      });
    });
  }

  #resetForLoad(): void {
    this.#destroyed = false;
    this.#metadataPublished = false;
    this.#ended = false;
    this.#patternJob?.abort();
    this.#patternJob = undefined;
    this.#patternSong = null;
    this.#channelMutes = [];
    this.onPattern(null);
  }

  #teardownLink(): void {
    this.#destroyed = true;
    this.#linkReady = null;
    const link = this.#link;
    this.#link = null;
    if (link) {
      audioBusService.disconnect(link.node);
      link.close();
    }
    this.#destroyed = false;
  }

  async #applyStoredSettings(): Promise<void> {
    if (this.#settingsApplied) {
      const settings = this.#settingsApplied;
      this.#settingsApplied = settings;
      await this.applySettings(settings);
    }
  }

  #loadPatterns(token: number): void {
    this.#patternJob?.abort();
    const track = this.#track;
    if (!track?.file) return;
    const job = new AbortController();
    this.#patternJob = job;
    const subsong = this.#subsong;
    const isHively = this.#isHively;
    void track.file.arrayBuffer().then((buffer) => {
      if (job.signal.aborted || token !== this.#loadToken) return;
      if (isHively) {
        // Hively pattern songs come from output-free replay-core inspection,
        // not from a second audio player.
        return inspectHivelyPatterns(buffer.slice(0), subsong, job.signal).then((inspection) => {
          if (job.signal.aborted || token !== this.#loadToken || subsong !== this.#subsong) return;
          this.#patternSong = inspection.song;
          this.onPattern({ song: inspection.song });
          // Upgrade the title-only transport metadata with the richer
          // inspection facts (instruments/orders/duration).
          if (this.#track) {
            this.#metadataPublished = true;
            this.#subsongCount = Math.max(1, inspection.metadata.subsongs);
            this.onMetadata({
              title: inspection.metadata.title || undefined,
              trackerType: 'HivelyTracker',
              originalType: this.#track.extension.toLowerCase(),
              duration: inspection.metadata.duration || undefined,
              channels: inspection.metadata.channels,
              subsongs: inspection.metadata.subsongs
            });
            this.onSnapshot({ subsong: this.#subsong, subsongCount: this.#subsongCount });
          }
        });
      }
      return moduleDecoder.inspect(buffer.slice(0), { patterns: true, subsong, signal: job.signal }).then((inspection) => {
        if (job.signal.aborted || token !== this.#loadToken || subsong !== this.#subsong || !inspection.song) return;
        this.#patternSong = inspection.song;
        this.onPattern({ song: inspection.song });
      });
    }).catch((error) => {
      if (!job.signal.aborted) logWarning('decode', 'Module patterns could not be read', { error });
    });
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
          'module playback'
        );
        if (this.#destroyed) {
          audioBusService.disconnect(link.node);
          link.close();
          throw new Error('libzci module playback closed during startup');
        }
        this.#link = link;
        link.notifyContextState();
        audioBusService.connectAudioNode(link.node);
        audioBusService.setSourceGain(link.node, this.#transitionGain);
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
    const mapped = mapCoreSnapshot(message.core, 'module');
    this.onSnapshot(mapped);
    if (message.facts && this.#track && !this.#metadataPublished) {
      this.#metadataPublished = true;
      const metadata = metadataFromModuleFacts(message.facts, this.#track, mapped.duration ?? 0, this.#isHively);
      this.#subsongCount = Math.max(1, metadata.subsongs ?? 1);
      this.onMetadata(metadata);
      this.onSnapshot({ subsong: this.#subsong, subsongCount: this.#subsongCount });
    }
    if (message.core.module && this.#track) {
      this.onPattern({
        order: Math.max(0, Math.trunc(message.core.module.order)),
        pattern: Math.max(0, Math.trunc(message.core.module.pattern)),
        row: Math.max(0, Math.trunc(message.core.module.row))
      });
    }
    if (message.ended && !this.#ended) {
      this.#ended = true;
      mediaSessionService.pauseTransportAnchor();
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
