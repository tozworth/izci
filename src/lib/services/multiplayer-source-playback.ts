import { get } from 'svelte/store';
import { playerController } from '$lib/services/player-controller';
import type { MultiplayerPlayback } from '$lib/services/multiplayer-protocol';
import type { PlaybackSnapshot, PlaylistItem } from '$lib/types';

interface SavedPlayback {
  track: PlaylistItem | null;
  snapshot: PlaybackSnapshot;
}

class MultiplayerSourcePlaybackService {
  #savedPlayback: SavedPlayback | null = null;
  #latestPlayback: MultiplayerPlayback | null = null;
  #activeTrackId: string | null = null;
  #activeObjectUrl: string | null = null;
  #loadToken = 0;
  #enabled = true;

  beginClientSession(): void {
    if (this.#savedPlayback) return;
    this.#savedPlayback = {
      track: get(playerController.currentTrack),
      snapshot: get(playerController.snapshot)
    };
  }

  async endClientSession(): Promise<void> {
    const saved = this.#savedPlayback;
    this.#savedPlayback = null;
    this.#latestPlayback = null;
    this.#enabled = true;
    this.#clearRemotePlayback();
    if (!saved?.track) return;
    await playerController.load(saved.track, {
      autoPlay: false,
      initialPosition: saved.snapshot.currentTime
    }).catch(() => undefined);
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
    this.#latestPlayback = { ...playback, sentAt: Date.now() };
    if (!playback.track || playback.track.id !== this.#activeTrackId) return;
    this.#applyLatestPlayback();
  }

  async loadFile(track: PlaylistItem, file: File): Promise<boolean> {
    const playback = this.#latestPlayback;
    if (!playback?.track || playback.track.id !== track.id || track.kind === 'video') return false;

    const token = ++this.#loadToken;
    this.#revokeObjectUrl();
    const objectUrl = track.kind === 'stream' ? URL.createObjectURL(file) : undefined;
    this.#activeObjectUrl = objectUrl ?? null;
    this.#activeTrackId = track.id;
    const playableTrack: PlaylistItem = { ...track, file, objectUrl };
    const snapshot = playback.snapshot;
    const initialPosition = expectedPosition(playback);

    try {
      await playerController.load(playableTrack, {
        autoPlay: this.#enabled && snapshot.state === 'playing',
        initialPosition
      });
    } catch {
      if (token === this.#loadToken) this.#clearRemotePlayback();
      return false;
    }
    if (token !== this.#loadToken) return false;
    this.#applyLatestPlayback();
    return true;
  }

  clearSourceTrack(): void {
    this.#latestPlayback = null;
    this.#clearRemotePlayback();
  }

  clearLoadedFile(): void {
    this.#clearRemotePlayback();
  }

  resume(): boolean {
    if (!this.#enabled || !this.#activeTrackId) return false;
    this.#applyLatestPlayback();
    return true;
  }

  get active(): boolean {
    return this.#activeTrackId !== null;
  }

  #applyLatestPlayback(): void {
    const playback = this.#latestPlayback;
    if (!this.#enabled || !playback?.track || playback.track.id !== this.#activeTrackId) return;
    const local = get(playerController.snapshot);
    const target = expectedPosition(playback);
    const drift = Math.abs(local.currentTime - target);

    if (playback.snapshot.state === 'playing') {
      if (drift > 1) playerController.seek(target);
      playerController.play();
      return;
    }
    playerController.pause();
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

export const multiplayerSourcePlaybackService = new MultiplayerSourcePlaybackService();
