import { createChiptunePlayer } from '$lib/services/chiptune-loader';
import type { PlaylistItem, TrackMetadata } from '$lib/types';
import type { Chiptune3Metadata, ChiptuneJsPlayer } from 'chiptune3';

const MODULE_METADATA_TIMEOUT_MS = 10_000;

function toNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))
      ? Number(value)
      : undefined;
}

function toTrackMetadata(metadata: Chiptune3Metadata): TrackMetadata {
  const song = metadata.song;

  return {
    title: metadata.title || metadata.songtitle || undefined,
    artist: metadata.artist || undefined,
    message: metadata.message || metadata.message_raw || undefined,
    trackerType: metadata.tracker || metadata.originaltype_long || metadata.type || undefined,
    originalType: metadata.originaltype || undefined,
    duration: toNumber(metadata.dur),
    patterns: metadata.totalPatterns ?? song?.patterns.length,
    channels: toNumber(metadata.channels) ?? song?.channels.length,
    instruments: song?.instruments.length,
    orders: metadata.totalOrders ?? song?.orders.length,
    subsongs: song?.numSubsongs,
    rows: song?.patterns.reduce((total, pattern) => total + pattern.rows.length, 0),
    subsongNames: Array.isArray(metadata.songs)
      ? metadata.songs.filter((value): value is string => typeof value === 'string')
      : undefined
  };
}

async function resolveTrackFile(track: PlaylistItem): Promise<File | null> {
  if (track.fileHandle) {
    try {
      return await track.fileHandle.getFile();
    } catch {
      // Fall back to the in-memory File when permission is unavailable or stale.
    }
  }

  return track.file ?? null;
}

function disposePlayer(player: ChiptuneJsPlayer): void {
  try {
    player.stop();
  } catch {
    // Ignore teardown failures during background metadata probing.
  }

  try {
    player.gain.disconnect();
  } catch {
    // Ignore disconnect failures during teardown.
  }

  void player.context.close().catch(() => undefined);
}

export async function loadModuleMetadata(track: PlaylistItem | null): Promise<TrackMetadata | null> {
  if (typeof window === 'undefined' || !track || track.kind !== 'module') {
    return null;
  }

  try {
    const file = await resolveTrackFile(track);

    if (!file) {
      return null;
    }

    const player = await createChiptunePlayer({});
    const buffer = await file.arrayBuffer();

    return await new Promise<TrackMetadata | null>((resolve) => {
      let settled = false;

      const finish = (metadata: TrackMetadata | null) => {
        if (settled) {
          return;
        }

        settled = true;
        window.clearTimeout(timeoutId);
        disposePlayer(player);
        resolve(metadata);
      };

      const timeoutId = window.setTimeout(() => {
        finish(null);
      }, MODULE_METADATA_TIMEOUT_MS);

      player.setVol(0);
      player.onMetadata((metadata) => {
        finish(toTrackMetadata(metadata));
      });
      player.onError(() => {
        finish(null);
      });

      try {
        player.play(buffer);
        player.pause();
      } catch {
        finish(null);
      }
    });
  } catch {
    return null;
  }
}
