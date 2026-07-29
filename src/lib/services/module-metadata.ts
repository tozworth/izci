import { createChiptunePlayer } from '$lib/services/chiptune-loader';
import { HIVELY_MODULE_EXTENSIONS, type PlaylistItem, type TrackMetadata } from '$lib/types';
import type { Chiptune3Metadata, ChiptuneJsPlayer } from 'chiptune3';

const MODULE_METADATA_TIMEOUT_MS = 10_000;

export function parseHivelyMetadata(buffer: ArrayBuffer): TrackMetadata | null {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 16) {
    return null;
  }

  const isAhx = bytes[0] === 0x54 && bytes[1] === 0x48 && bytes[2] === 0x58 && bytes[3] < 3;
  const isHvl = bytes[0] === 0x48 && bytes[1] === 0x56 && bytes[2] === 0x4c && bytes[3] < 2;
  if (!isAhx && !isHvl) return null;

  const titleOffset = (bytes[4] << 8) | bytes[5];
  let title: string | undefined;
  if (titleOffset < bytes.length) {
    let titleEnd = titleOffset;
    while (titleEnd < bytes.length && bytes[titleEnd] !== 0 && titleEnd - titleOffset < 128) titleEnd++;
    const decoded = new TextDecoder().decode(bytes.subarray(titleOffset, titleEnd)).trim();
    title = decoded || undefined;
  }

  return {
    title,
    trackerType: isHvl ? 'HivelyTracker' : "Abyss' Highest eXperience",
    originalType: isHvl ? 'hvl' : 'ahx',
    channels: isHvl ? (bytes[8] >> 2) + 4 : 4,
    instruments: bytes[12],
    orders: ((bytes[6] & 0x0f) << 8) | bytes[7],
    subsongs: bytes[13] + 1
  };
}

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

    const buffer = await file.arrayBuffer();

    if (
      HIVELY_MODULE_EXTENSIONS.includes(
        track.extension.toLowerCase() as (typeof HIVELY_MODULE_EXTENSIONS)[number]
      )
    ) {
      return parseHivelyMetadata(buffer);
    }

    const player = await createChiptunePlayer({});

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
