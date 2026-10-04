import { moduleDecoder } from './openmpt/decoder';
import { logDebug, logInfo, logWarning } from '$lib/services/logging';
import { HIVELY_MODULE_EXTENSIONS, type TrackItem, type TrackMetadata } from '$lib/types';
import { nativeFilesystem } from '$platform';

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

async function resolveTrackFile(track: TrackItem): Promise<File | null> {
  if (track.nativeFile && nativeFilesystem) return track.file ?? nativeFilesystem.materializeFile(track.nativeFile);
  if (track.fileHandle) {
    try {
      return await track.fileHandle.getFile();
    } catch {
      // Fall back to the in-memory File when permission is unavailable or stale.
    }
  }

  return track.file ?? null;
}

export async function loadModuleMetadata(track: TrackItem | null): Promise<TrackMetadata | null> {
  if (!track || track.kind !== 'module') return null;
  logDebug('decode', 'Probing module metadata', { id: track.id, name: track.name });
  try {
    const file = await resolveTrackFile(track);
    if (!file) return null;
    const buffer = await file.arrayBuffer();
    if ((HIVELY_MODULE_EXTENSIONS as readonly string[]).includes(track.extension.toLowerCase())) {
      return parseHivelyMetadata(buffer);
    }
    const { metadata } = await moduleDecoder.inspect(buffer, { subsong: track.subsong });
    logInfo('decode', 'Module metadata probe completed', { id: track.id, channels: metadata.channels, subsongs: metadata.subsongs });
    return metadata;
  } catch (error) {
    logWarning('decode', 'Module metadata probe failed', { id: track.id, error });
    return null;
  }
}
