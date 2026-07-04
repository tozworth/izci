import { extractStreamVorbisComments } from '$lib/services/stream-artwork';
import type { PlaylistItem } from '$lib/types';

export interface TimedLyricLine {
  time: number;
  text: string;
}

export interface LoadedLyrics {
  raw: string;
  lines: TimedLyricLine[];
  source: 'vorbis-comments';
}

const VORBIS_LYRICS_KEYS = ['LYRICS', 'SYNCEDLYRICS', 'SYNCED LYRICS'];
const LRC_TIMESTAMP_PATTERN = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

async function resolveTrackFile(track: PlaylistItem): Promise<File | null> {
  if (track.fileHandle) {
    try {
      return await track.fileHandle.getFile();
    } catch {
      // Fall through to the in-memory File if a persisted handle cannot be read.
    }
  }

  return track.file ?? null;
}

function parseTimestamp(minutes: string, seconds: string, fraction: string | undefined): number | null {
  const minuteValue = Number(minutes);
  const secondValue = Number(seconds);

  if (!Number.isFinite(minuteValue) || !Number.isFinite(secondValue) || secondValue > 59) {
    return null;
  }

  const millisecondValue = Number((fraction ?? '0').padEnd(3, '0').slice(0, 3));
  return minuteValue * 60 + secondValue + millisecondValue / 1000;
}

export function parseLrcLyrics(raw: string): TimedLyricLine[] {
  const lines: TimedLyricLine[] = [];

  for (const rawLine of raw.split(/\r?\n/)) {
    LRC_TIMESTAMP_PATTERN.lastIndex = 0;
    const matches = [...rawLine.matchAll(LRC_TIMESTAMP_PATTERN)];

    if (matches.length === 0) {
      continue;
    }

    const text = rawLine.replace(LRC_TIMESTAMP_PATTERN, '').trim();

    for (const match of matches) {
      const time = parseTimestamp(match[1], match[2], match[3]);

      if (time !== null) {
        lines.push({ time, text });
      }
    }
  }

  return lines.sort((left, right) => left.time - right.time);
}

export function stripLrcTimestamps(raw: string): string {
  return raw
    .split(/\r?\n/)
    .map((line) => line.replace(LRC_TIMESTAMP_PATTERN, '').trim())
    .join('\n')
    .trim();
}

export function findActiveLyricIndex(lines: TimedLyricLine[], currentTime: number): number {
  if (lines.length === 0 || !Number.isFinite(currentTime)) {
    return -1;
  }

  let low = 0;
  let high = lines.length - 1;
  let activeIndex = -1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);

    if (lines[middle].time <= currentTime) {
      activeIndex = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return activeIndex;
}

function findVorbisLyricsComment(comments: Array<{ key: string; value: string }>): string {
  for (const key of VORBIS_LYRICS_KEYS) {
    const comment = comments.find((entry) => entry.key.trim().toUpperCase() === key);
    const value = comment?.value.trim();

    if (value) {
      return value;
    }
  }

  return '';
}

export async function loadTrackLyrics(track: PlaylistItem | null): Promise<LoadedLyrics | null> {
  if (!track || track.kind !== 'stream') {
    return null;
  }

  const file = await resolveTrackFile(track);

  if (!file) {
    return null;
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const raw = findVorbisLyricsComment(extractStreamVorbisComments(bytes, track.extension));

  if (!raw) {
    return null;
  }

  return {
    raw,
    lines: parseLrcLyrics(raw),
    source: 'vorbis-comments'
  };
}
