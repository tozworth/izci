/**
 * Svelte-side boundary for core transient lyric documents.
 *
 * The core owns bounded plain/LRC parsing, clock offsets, and audible-time
 * lookup; documents stay transient (never catalog fields or persisted
 * snapshots). This module pins the `LyricsDocument` shape and the active-cue
 * lookup used by the future owner worker when serving `WebLyrics` snapshots
 * to lyric presentation. Nothing here reads files or starts jobs.
 *
 * Shapes mirror the Rust `lyrics::LyricsDocument`/`LyricLine` structs.
 */

export interface CoreLyricLine {
  time_ms: number;
  text: string;
}

export interface CoreLyricsDocument {
  raw: string;
  plain: string;
  lines: CoreLyricLine[];
  /** LRC clock offset in ms: positive values advance lyrics relative to audio. */
  offset_ms: number;
}

export interface ActiveCueRange {
  start: number;
  end: number;
}

export const LYRICS_MAX_BYTES = 256 * 1024;
export const LYRICS_MAX_CUES = 8_192;
export const LYRICS_MAX_LINE_BYTES = 4_096;
export const LYRICS_MAX_OFFSET_MS = 86_400_000;

function isValidOffset(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    Math.abs(value) <= LYRICS_MAX_OFFSET_MS
  );
}

/** Validate a lyric document before feeding it to presentation. */
export function validateLyricsDocument(document: CoreLyricsDocument): void {
  if (typeof document.raw !== 'string' || document.raw.length > LYRICS_MAX_BYTES || document.raw.includes('\0')) {
    throw new Error('Invalid lyric raw: expected 0..256 KiB without NUL');
  }
  if (typeof document.plain !== 'string' || document.plain.length > LYRICS_MAX_BYTES || document.plain.includes('\0')) {
    throw new Error('Invalid lyric plain: expected 0..256 KiB without NUL');
  }
  if (!Array.isArray(document.lines) || document.lines.length > LYRICS_MAX_CUES) {
    throw new Error(`Invalid lyric lines: expected 0..${LYRICS_MAX_CUES} cues`);
  }
  for (const line of document.lines) {
    if (!Number.isSafeInteger(line.time_ms) || line.time_ms < 0) {
      throw new Error(`Invalid lyric time_ms: ${String(line.time_ms)}`);
    }
    if (typeof line.text !== 'string' || line.text.length > LYRICS_MAX_LINE_BYTES || line.text.includes('\0')) {
      throw new Error('Invalid lyric text: expected 0..4096 chars without NUL');
    }
  }
  if (!isValidOffset(document.offset_ms)) {
    throw new Error(`Invalid lyric offset_ms: ${String(document.offset_ms)}`);
  }
}

/**
 * Active cue range at audible `seconds`, mirroring `LyricsDocument::active`:
 * floor to ms, last cue at or before now, grouped by equal timestamps.
 * Returns `null` before the first cue or for non-finite/negative input.
 * Assumes `lines` are sorted by `time_ms` as produced by core parsing.
 */
export function activeCueRange(document: CoreLyricsDocument, seconds: number): ActiveCueRange | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return null;
  const time = Math.floor(seconds * 1_000);
  // partition_point(time_ms <= time)
  let low = 0;
  let high = document.lines.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (document.lines[mid].time_ms <= time) low = mid + 1;
    else high = mid;
  }
  const end = low;
  if (end === 0) return null;
  const stamp = document.lines[end - 1].time_ms;
  // partition_point(time_ms < stamp) within [0, end)
  let startLow = 0;
  let startHigh = end;
  while (startLow < startHigh) {
    const mid = (startLow + startHigh) >>> 1;
    if (document.lines[mid].time_ms < stamp) startLow = mid + 1;
    else startHigh = mid;
  }
  return { start: startLow, end };
}
