import { extractStreamVorbisComments } from '$lib/services/stream-meta-ogg';
import type { TrackItem } from '$lib/types';

export interface TimedLyricLine {
  time: number;
  text: string;
}

export interface TheaterLyricRow {
  id: string;
  type: 'lyric' | 'downtime';
  time: number;
  text: string;
  lyricIndex: number;
}

export interface LoadedLyrics {
  raw: string;
  lines: TimedLyricLine[];
  source: 'vorbis-comments' | 'embedded-metadata';
}

const VORBIS_LYRICS_KEYS = ['LYRICS', 'SYNCEDLYRICS', 'SYNCED LYRICS'];
const LRC_TIMESTAMP_PATTERN = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const DEFAULT_DOWNTIME_THRESHOLD_SECONDS = 10;
const lyricsLoadCache = new Map<string, Promise<LoadedLyrics | null>>();

async function resolveTrackFile(track: TrackItem): Promise<File | null> {
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

    if (!text) {
      continue;
    }

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

export function findActiveTimelineIndex(lines: Array<{ time: number }>, currentTime: number): number {
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

export function findActiveLyricIndex(lines: TimedLyricLine[], currentTime: number): number {
  return findActiveTimelineIndex(lines, currentTime);
}

export function buildTheaterLyricRows(
  lines: TimedLyricLine[],
  duration = 0,
  includeDowntime = true,
  downtimeThresholdSeconds = DEFAULT_DOWNTIME_THRESHOLD_SECONDS
): TheaterLyricRow[] {
  const rows: TheaterLyricRow[] = [];
  const thresholdSeconds =
    Number.isFinite(downtimeThresholdSeconds) && downtimeThresholdSeconds > 0
      ? downtimeThresholdSeconds
      : DEFAULT_DOWNTIME_THRESHOLD_SECONDS;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const isFirstLine = index === 0;
    const nextLine = lines[index + 1] ?? null;

    if (includeDowntime && isFirstLine && line.time > thresholdSeconds) {
      rows.push({
        id: `downtime-start-${line.time}`,
        type: 'downtime',
        time: 0,
        text: '',
        lyricIndex: -1
      });
    }

    rows.push({
      id: `lyric-${index}-${line.time}`,
      type: 'lyric',
      time: line.time,
      text: line.text,
      lyricIndex: index
    });

    if (!includeDowntime) {
      continue;
    }

    const downtimeStart = line.time + thresholdSeconds;

    if (nextLine) {
      if (nextLine.time - line.time > thresholdSeconds) {
        rows.push({
          id: `downtime-${index}-${downtimeStart}`,
          type: 'downtime',
          time: downtimeStart,
          text: '',
          lyricIndex: -1
        });
      }

      continue;
    }

    if (duration <= 0 || duration - line.time > thresholdSeconds) {
      rows.push({
        id: `downtime-end-${index}-${downtimeStart}`,
        type: 'downtime',
        time: downtimeStart,
        text: '',
        lyricIndex: -1
      });
    }
  }

  return rows;
}

export function hasRenderableLyrics(raw: string, lines = parseLrcLyrics(raw)): boolean {
  if (lines.length > 0) {
    return true;
  }

  const untimedLines = stripLrcTimestamps(raw)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return untimedLines.length > 1;
}

export function getTrackLyricsLoadKey(track: TrackItem | null): string {
  return track ? `${track.id}:${track.extension}:${track.lastModified}:${track.size}` : '';
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

async function loadTrackLyricsUncached(track: TrackItem): Promise<LoadedLyrics | null> {
  const file = await resolveTrackFile(track);

  if (!file) {
    return null;
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  let raw = findVorbisLyricsComment(extractStreamVorbisComments(bytes, track.extension));
  let source: LoadedLyrics['source'] = 'vorbis-comments';

  if (!raw) {
    const { ALL_FORMATS, BlobSource, Input } = await import('mediabunny');
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    try {
      raw = (await input.getMetadataTags()).lyrics?.trim() ?? '';
      source = 'embedded-metadata';
    } finally {
      input.dispose();
    }
  }

  if (!raw) {
    return null;
  }

  const lines = parseLrcLyrics(raw);

  if (!hasRenderableLyrics(raw, lines)) {
    return null;
  }

  return {
    raw,
    lines,
    source
  };
}

export async function loadTrackLyrics(track: TrackItem | null): Promise<LoadedLyrics | null> {
  if (!track || track.kind !== 'stream') {
    return null;
  }

  const cacheKey = getTrackLyricsLoadKey(track);

  if (!cacheKey) {
    return null;
  }

  const cachedLyrics = lyricsLoadCache.get(cacheKey);

  if (cachedLyrics) {
    return cachedLyrics;
  }

  const lyricsPromise = loadTrackLyricsUncached(track).catch((error: unknown) => {
    lyricsLoadCache.delete(cacheKey);
    throw error;
  });

  lyricsLoadCache.set(cacheKey, lyricsPromise);
  return lyricsPromise;
}
