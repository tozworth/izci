import { get } from 'svelte/store';
import type { Unsubscriber } from 'svelte/store';
import { playerController } from '$lib/services/player-controller';
import { logError, logInfo } from '$lib/services/logging';
import type { MultiplayerPlayback } from '$lib/services/multiplayer-protocol';
import type { PlaybackSnapshot, PlaylistItem } from '$lib/types';

interface SavedPlayback {
  track: PlaylistItem | null;
  snapshot: PlaybackSnapshot;
}

export class MultiplayerSourcePlaybackService {
  #savedPlayback: SavedPlayback | null = null;
  #latestPlayback: MultiplayerPlayback | null = null;
  #activeTrackId: string | null = null;
  #activeObjectUrl: string | null = null;
  #loadToken = 0;
  #enabled = true;
  #localTimeline = false;
  #onEnded: ((trackId: string) => void) | null = null;
  #unsubscribeEnded: Unsubscriber | null = null;
  #previousPlaybackState: PlaybackSnapshot['state'] = 'idle';

  beginClientSession(onEnded?: (trackId: string) => void): void {
    if (this.#savedPlayback) return;
    this.#savedPlayback = {
      track: get(playerController.currentTrack),
      snapshot: get(playerController.snapshot)
    };
    this.#onEnded = onEnded ?? null;
    this.#previousPlaybackState = get(playerController.snapshot).state;
    this.#unsubscribeEnded = playerController.snapshot.subscribe((snapshot) => {
      const ended = snapshot.state === 'ended' && this.#previousPlaybackState !== 'ended';
      this.#previousPlaybackState = snapshot.state;
      if (ended && this.#activeTrackId) {
        logInfo('freeplay', 'Source-file playback ended', { trackId: this.#activeTrackId });
        this.#onEnded?.(this.#activeTrackId);
      }
    });
  }

  async endClientSession(): Promise<void> {
    const saved = this.#savedPlayback;
    this.#savedPlayback = null;
    this.#latestPlayback = null;
    this.#enabled = true;
    this.#localTimeline = false;
    this.#unsubscribeEnded?.();
    this.#unsubscribeEnded = null;
    this.#onEnded = null;
    this.#clearRemotePlayback();
    if (!saved?.track) return;
    await playerController.load(saved.track, {
      autoPlay: false,
      initialPosition: saved.snapshot.currentTime
    }).catch((error) => logError('freeplay', 'Local playback restoration failed', error));
  }

  setLocalTimeline(active: boolean): void {
    if (this.#localTimeline === active) return;
    this.#localTimeline = active;
    if (!active) this.#applyLatestPlayback();
  }

  setEnabled(enabled: boolean): void {
    this.#enabled = enabled;
    if (!enabled) {
      playerController.pause();
      return;
    }
    this.#applyLatestPlayback();
  }

  syncPlayback(playback: MultiplayerPlayback): void {
    const previousPlayback = this.#latestPlayback;
    this.#latestPlayback = { ...playback, sentAt: Date.now() };
    if (!playback.track || playback.track.id !== this.#activeTrackId) return;
    this.#applyLatestPlayback(hasTimelineDiscontinuity(previousPlayback, this.#latestPlayback));
  }

  async loadFile(track: PlaylistItem, file: File): Promise<boolean> {
    const playback = this.#latestPlayback;
    if (!playback?.track || playback.track.id !== track.id || track.kind === 'video') return false;

    const token = ++this.#loadToken;
    const objectUrl = track.kind === 'stream' ? URL.createObjectURL(file) : undefined;
    const playableTrack: PlaylistItem = { ...track, file, objectUrl };
    const snapshot = playback.snapshot;
    const initialPosition = this.#localTimeline ? 0 : expectedPosition(playback);
    const previousObjectUrl = this.#activeObjectUrl;

    try {
      if (this.#localTimeline) {
        await playerController.load(playableTrack, {
          autoPlay: this.#enabled,
          initialPosition: 0
        });
      } else if (this.#activeTrackId
        && this.#enabled
        && (snapshot.state === 'playing' || snapshot.state === 'loading')) {
        const ready = await playerController.prepareNext(playableTrack);
        if (token !== this.#loadToken) {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          return false;
        }
        if (!ready || !playerController.commitPrepared(track.id)) {
          throw new Error('Could not prepare the transferred track.');
        }
        const latestPosition = this.#latestPlayback?.track?.id === track.id
          ? expectedPosition(this.#latestPlayback)
          : initialPosition;
        if (latestPosition > 0) playerController.seek(latestPosition);
      } else {
        await playerController.load(playableTrack, {
          autoPlay: this.#enabled && snapshot.state === 'playing',
          initialPosition
        });
      }
    } catch (error) {
      logError('freeplay', 'Source-file load failed', { trackId: track.id, error });
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (token === this.#loadToken) this.#clearRemotePlayback();
      return false;
    }
    if (token !== this.#loadToken) {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      return false;
    }
    this.#activeObjectUrl = objectUrl ?? null;
    this.#activeTrackId = track.id;
    if (previousObjectUrl && previousObjectUrl !== objectUrl) URL.revokeObjectURL(previousObjectUrl);
    this.#applyLatestPlayback();
    logInfo('freeplay', 'Source file received and loaded', { trackId: track.id, bytes: file.size });
    return true;
  }

  clearSourceTrack(): void {
    this.#latestPlayback = null;
    this.#clearRemotePlayback();
  }

  clearLoadedFile(): void {
    this.#clearRemotePlayback();
  }

  replay(): boolean {
    if (!this.#enabled || !this.#activeTrackId) return false;
    playerController.seek(0);
    if (get(playerController.snapshot).state !== 'playing') playerController.play();
    return true;
  }

  resume(): boolean {
    if (!this.#enabled || !this.#activeTrackId) return false;
    if (!this.#localTimeline) this.#applyLatestPlayback();
    return true;
  }

  get active(): boolean {
    return this.#activeTrackId !== null;
  }

  isTrackReady(trackId: string): boolean {
    return this.#activeTrackId === trackId;
  }

  #applyLatestPlayback(forceSeek = false): void {
    if (this.#localTimeline) return;
    const playback = this.#latestPlayback;
    if (!this.#enabled || !playback?.track || playback.track.id !== this.#activeTrackId) return;
    const local = get(playerController.snapshot);
    const target = expectedPosition(playback);
    const drift = Math.abs(local.currentTime - target);
    const canCorrectDrift = forceSeek || !isDocumentHidden();

    if (playback.snapshot.state === 'playing') {
      if (drift > 1 && canCorrectDrift) playerController.seek(target);
      if (local.state !== 'playing') playerController.play();
      return;
    }
    if (local.state === 'playing' || local.state === 'loading') playerController.pause();
    if (drift > 0.25 && playback.snapshot.state !== 'idle') playerController.seek(target);
  }

  #clearRemotePlayback(): void {
    this.#loadToken += 1;
    if (this.#activeTrackId) playerController.unload();
    this.#activeTrackId = null;
    this.#revokeObjectUrl();
  }

  #revokeObjectUrl(): void {
    if (this.#activeObjectUrl) URL.revokeObjectURL(this.#activeObjectUrl);
    this.#activeObjectUrl = null;
  }
}

function expectedPosition(playback: MultiplayerPlayback): number {
  const elapsed = playback.snapshot.state === 'playing'
    ? Math.max(0, (Date.now() - playback.sentAt) / 1_000)
    : 0;
  const duration = playback.snapshot.duration > 0
    ? playback.snapshot.duration
    : Number.POSITIVE_INFINITY;
  return Math.min(Math.max(playback.snapshot.currentTime + elapsed, 0), duration);
}

function hasTimelineDiscontinuity(
  previous: MultiplayerPlayback | null,
  next: MultiplayerPlayback
): boolean {
  if (!previous?.track || !next.track || previous.track.id !== next.track.id) return false;
  return Math.abs(expectedPosition(previous) - expectedPosition(next)) > 1;
}

function isDocumentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

export const multiplayerSourcePlaybackService = new MultiplayerSourcePlaybackService();
