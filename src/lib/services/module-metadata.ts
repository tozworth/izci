import { createChiptunePlayer } from '$lib/services/chiptune-loader';
import { logDebug, logInfo, logWarning } from '$lib/logging/api';
import { HIVELY_MODULE_EXTENSIONS } from '$lib/contracts/media-format';
import { type MediaEntity } from '$lib/contracts/catalog';
import { type TrackMetadata } from '$lib/contracts/media-metadata';
import { withMediaFile } from '$lib/stores/playlist-materialization';
import type { Chiptune3Metadata, ChiptuneJsPlayer } from 'chiptune3';

const MODULE_METADATA_TIMEOUT_MS = 10_000;

interface HivelyName {
  value: string;
  nextOffset: number;
}

function readHivelyName(bytes: Uint8Array, offset: number): HivelyName | null {
  if (offset < 0 || offset >= bytes.length) {
    return null;
  }

  let end = offset;
  while (end < bytes.length && bytes[end] !== 0) end++;

  return {
    value: new TextDecoder().decode(bytes.subarray(offset, Math.min(end, offset + 128))).trim(),
    nextOffset: Math.min(end + 1, bytes.length)
  };
}

export function parseHivelyMetadata(buffer: ArrayBuffer): TrackMetadata | null {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 16) {
    return null;
  }

  const isAhx = bytes[0] === 0x54 && bytes[1] === 0x48 && bytes[2] === 0x58 && bytes[3] < 3;
  const isHvl = bytes[0] === 0x48 && bytes[1] === 0x56 && bytes[2] === 0x4c && bytes[3] < 2;
  if (!isAhx && !isHvl) return null;

  const titleOffset = (bytes[4] << 8) | bytes[5];
  const instrumentCount = bytes[12];
  const titleName = readHivelyName(bytes, titleOffset);
  const instrumentNames: string[] = [];
  let nameOffset = titleName?.nextOffset ?? bytes.length;

  for (let index = 0; index < instrumentCount; index++) {
    const instrumentName = readHivelyName(bytes, nameOffset);
    if (!instrumentName) break;
    instrumentNames.push(instrumentName.value);
    nameOffset = instrumentName.nextOffset;
  }

  const message = instrumentNames.join('\n').trim();

  return {
    title: titleName?.value || undefined,
    trackerType: isHvl ? 'HivelyTracker' : "Abyss' Highest eXperience",
    originalType: isHvl ? 'hvl' : 'ahx',
    channels: isHvl ? (bytes[8] >> 2) + 4 : 4,
    tracks: bytes[11],
    instruments: instrumentCount,
    orders: ((bytes[6] & 0x0f) << 8) | bytes[7],
    subsongs: bytes[13] + 1,
    message: message || undefined
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

export async function loadModuleMetadata(track: MediaEntity | null): Promise<TrackMetadata | null> {
  if (typeof window === 'undefined' || !track || track.kind !== 'module') {
    return null;
  }

  logDebug('decode', 'Probing module metadata', { id: track.id, name: track.name, format: track.format });
  try {
    const buffer = await withMediaFile(track, (file) => file.arrayBuffer());
    if (!buffer) {
      logWarning('decode', 'Module metadata probe has no readable file', { id: track.id });
      return null;
    }

    if (
      HIVELY_MODULE_EXTENSIONS.includes(
        track.format.toLowerCase() as (typeof HIVELY_MODULE_EXTENSIONS)[number]
      )
    ) {
      const metadata = parseHivelyMetadata(buffer);
      if (metadata) logInfo('decode', 'Hively metadata probe completed', { id: track.id, subsongs: metadata.subsongs, channels: metadata.channels });
      else logWarning('decode', 'Hively metadata probe failed', { id: track.id });
      return metadata;
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
  } catch (error) {
    logWarning('decode', 'Module metadata probe failed', { id: track.id, format: track.format, error });
    return null;
  }
}
