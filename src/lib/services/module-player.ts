import { audioBusService } from '$lib/services/audio-bus';
import { logDebug, logError, logInfo, logWarning } from '$lib/services/logging';
import { mediaSessionService } from '$lib/services/media-session';
import { moduleDecoder } from './openmpt/decoder';
import { OpenMptPlayer } from './openmpt/player';
import type { OpenMptInspection, OpenMptProgress, OpenMptSettings } from './openmpt/protocol';
import { modulePlaybackSettings } from '$lib/stores/module-playback-settings';
import type { ModulePatternSnapshot, ModulePlaybackSettings, PlaybackSnapshot, TrackItem, TrackMetadata } from '$lib/types';

/** App-facing backend; the controller owns its worklet and the decoder owns patterns. */
export class ModulePlayerService {
  #player: OpenMptPlayer | null = null;
  #buffer: ArrayBuffer | null = null;
  #extension = '';
  #loadToken = 0;
  #patternJob: AbortController | undefined;
  #playing = false;
  #ready = false;
  #currentTime = 0;
  #subsong = 0;
  #subsongCount = 1;
  #lastPublishedTime = -1;
  #settings = modulePlaybackSettings.getSnapshot();
  #transitionGain = 1;
  #channelMutes: boolean[] = [];

  constructor(
    private readonly onSnapshot: (snapshot: Partial<PlaybackSnapshot>) => void,
    private readonly onMetadata: (metadata: TrackMetadata) => void,
    private readonly onPattern: (snapshot: Partial<ModulePatternSnapshot> | null) => void,
    private readonly onEnded: () => void
  ) {}

  async load(track: TrackItem): Promise<void> {
    if (!track.file) throw new Error('Expected a file for tracker module playback.');
    this.#reset();
    const token = ++this.#loadToken;
    this.#extension = track.extension.toLowerCase();
    // The file determines the count; don't clamp a requested subsong to stale metadata.
    this.#subsong = Number.isFinite(track.subsong) ? Math.max(0, Math.trunc(track.subsong!)) : 0;
    this.onSnapshot({ backend: 'module', state: 'loading', currentTime: 0, duration: 0, subsong: this.#subsong, subsongCount: 1, error: undefined });
    logInfo('playback', 'Module load started', { id: track.id, name: track.name, subsong: this.#subsong });
    try {
      const buffer = await track.file.arrayBuffer();
      if (token !== this.#loadToken) return;
      const player = await OpenMptPlayer.create(audioBusService.context);
      if (token !== this.#loadToken) { player.dispose(); return; }
      this.#player = player;
      this.#buffer = buffer;
      player.handlers = {
        metadata: (inspection) => { if (this.#active(player, token)) this.#metadata(inspection); },
        progress: (progress) => { if (this.#active(player, token)) this.#progress(progress); },
        ended: () => {
          if (!this.#active(player, token)) return;
          this.#playing = false;
          this.#currentTime = player.duration;
          this.onSnapshot({ state: 'ended', currentTime: this.#currentTime });
          mediaSessionService.pauseTransportAnchor();
          this.onEnded();
        },
        error: (message) => {
          if (!this.#active(player, token)) return;
          this.#playing = this.#ready = false;
          this.onSnapshot({ state: 'error', error: message });
          mediaSessionService.pauseTransportAnchor();
          logError('decode', 'Module playback failed', { message });
        }
      };
      audioBusService.connectAudioNode(player.gain);
      audioBusService.setSourceGain(player.gain, this.#transitionGain);
      const inspection = await player.load(buffer.slice(0), this.#subsong, this.#config());
      if (!this.#active(player, token)) return;
      this.#metadata(inspection, true);
      this.#ready = true;
      this.#applySettings();
      this.onSnapshot({ state: 'paused', error: undefined });
      mediaSessionService.activateTransportAnchor();
      mediaSessionService.pauseTransportAnchor();
      this.#loadPatterns(token);
    } catch (error) {
      if (token !== this.#loadToken) return;
      this.#disposePlayer();
      logError('decode', 'Module loading failed', { error });
      throw error;
    }
  }

  play(): void {
    if (!this.#player || !this.#ready || this.#playing) return;
    audioBusService.resume();
    this.#player.play();
    this.#playing = true;
    this.onSnapshot({ state: 'playing', error: undefined });
    mediaSessionService.playTransportAnchor();
  }

  pause(): void {
    if (!this.#player || !this.#playing) return;
    this.#player.pause();
    this.#playing = false;
    this.onSnapshot({ state: 'paused', currentTime: this.#currentTime });
    mediaSessionService.pauseTransportAnchor();
  }

  stop(options: { silent?: boolean } = {}): void {
    this.#reset();
    mediaSessionService.deactivateTransportAnchor();
    if (!options.silent) this.onSnapshot({ state: 'paused', currentTime: 0, error: undefined });
  }

  #reset(): void {
    ++this.#loadToken;
    this.#patternJob?.abort();
    this.#patternJob = undefined;
    this.#disposePlayer();
    this.#buffer = null;
    this.#playing = this.#ready = false;
    this.#currentTime = this.#subsong = 0;
    this.#subsongCount = 1;
    this.#lastPublishedTime = -1;
    this.#channelMutes = [];
    this.onPattern(null);
  }

  seek(seconds: number): void {
    if (this.#ready) this.#player?.seek(seconds);
    logDebug('playback', 'Module seek requested', { seconds });
    // Publish the decoder's actual clamped position from its response.
  }

  stepSubsong(direction: -1 | 1): number | null {
    if (!this.#player || !this.#ready || this.#subsongCount <= 1) return null;
    this.#subsong = (this.#subsong + direction + this.#subsongCount) % this.#subsongCount;
    this.#currentTime = 0;
    this.#lastPublishedTime = -1;
    this.#player.selectSubsong(this.#subsong);
    this.onSnapshot({ currentTime: 0, duration: 0, subsong: this.#subsong, error: undefined });
    this.#loadPatterns(this.#loadToken);
    return this.#subsong;
  }

  async applySettings(settings: ModulePlaybackSettings): Promise<void> {
    this.#settings = settings;
    this.#applySettings();
  }

  setTransitionGain(gain: number, durationSeconds = 0): void {
    this.#transitionGain = Number.isFinite(gain) ? Math.max(0, gain) : 1;
    audioBusService.setSourceGain(this.#player?.gain ?? null, this.#transitionGain, durationSeconds);
  }

  setChannelMutes(muted: boolean[]): void {
    this.#channelMutes = [...muted];
    if (this.#ready) this.#player?.setChannelMutes(this.#channelMutes);
  }

  #applySettings(): void {
    if (!this.#ready) return;
    this.#player?.configure(this.#config());
    this.#player?.setChannelMutes(this.#channelMutes);
  }

  #config(): OpenMptSettings {
    const { repeatCount, interpolationFilter, tempoFactor, pitchFactor } = this.#settings;
    return { repeatCount, interpolationFilter, tempoFactor, pitchFactor,
      stereoSeparation: this.#extension === 'mod' ? this.#settings.stereoSeparation : this.#settings.panStrength };
  }

  #metadata(inspection: OpenMptInspection, initial = false): void {
    if (!initial && inspection.subsong !== this.#subsong) return;
    this.#subsong = inspection.subsong;
    this.#subsongCount = inspection.metadata.subsongs ?? 1;
    this.onMetadata(inspection.metadata);
    this.onSnapshot({ duration: inspection.metadata.duration ?? 0, subsong: this.#subsong, subsongCount: this.#subsongCount, error: undefined });
  }

  #progress(progress: OpenMptProgress): void {
    if (progress.subsong !== this.#subsong) return;
    this.#currentTime = progress.currentTime;
    this.onPattern({ order: progress.order, pattern: progress.pattern, row: progress.row });
    if (Math.abs(this.#currentTime - this.#lastPublishedTime) < 0.125 && this.#playing) return;
    this.#lastPublishedTime = this.#currentTime;
    this.onSnapshot({ currentTime: this.#currentTime, duration: this.#player?.duration ?? 0 });
  }

  #loadPatterns(token: number): void {
    this.#patternJob?.abort();
    if (!this.#buffer) return;
    const job = new AbortController();
    this.#patternJob = job;
    const subsong = this.#subsong;
    void moduleDecoder.inspect(this.#buffer.slice(0), { patterns: true, subsong, signal: job.signal }).then((inspection) => {
      if (job.signal.aborted || token !== this.#loadToken || subsong !== this.#subsong || !inspection.song) return;
      // Progress can arrive while the worker expands patterns; preserve that position.
      this.onPattern({ song: inspection.song });
    }).catch((error) => {
      if (!job.signal.aborted) logWarning('decode', 'Module patterns could not be read', { error });
    });
  }

  #disposePlayer(): void {
    const player = this.#player;
    this.#player = null;
    audioBusService.disconnect(player?.gain ?? null);
    player?.dispose();
  }

  #active(player: OpenMptPlayer, token: number): boolean { return this.#player === player && token === this.#loadToken; }
}
