import type { ClipRange } from './clip-audio';

export interface EditableLyricLine {
  time: number | null;
  text: string;
}

const LRC_TIMESTAMP_PATTERN = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const LRC_METADATA_PATTERN = /^\[(?:ar|al|ti|au|by|offset|re|ve|length):/i;

function timestampFromMatch(match: RegExpMatchArray): number | null {
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds > 59) return null;
  const milliseconds = Number((match[3] ?? '0').padEnd(3, '0').slice(0, 3));
  return minutes * 60 + seconds + milliseconds / 1000;
}

export function parseLyricsForEditor(raw: string): EditableLyricLine[] {
  if (!raw) return [{ time: null, text: '' }];
  const sourceLines = raw.replace(/\r\n?/g, '\n').split('\n');
  if (sourceLines.at(-1) === '') sourceLines.pop();
  const lines: EditableLyricLine[] = [];

  for (const sourceLine of sourceLines) {
    if (LRC_METADATA_PATTERN.test(sourceLine.trim())) continue;
    LRC_TIMESTAMP_PATTERN.lastIndex = 0;
    const matches = [...sourceLine.matchAll(LRC_TIMESTAMP_PATTERN)];
    const text = sourceLine.replace(LRC_TIMESTAMP_PATTERN, '').trim();

    if (matches.length === 0) {
      lines.push({ time: null, text: sourceLine });
      continue;
    }

    for (const match of matches) {
      const time = timestampFromMatch(match);
      if (time !== null) lines.push({ time, text });
    }
  }

  return lines.length > 0 ? lines : [{ time: null, text: '' }];
}

export function formatLyricsTimestamp(time: number): string {
  const safeTime = Math.max(0, Number.isFinite(time) ? time : 0);
  const minutes = Math.floor(safeTime / 60);
  const seconds = safeTime - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(3).padStart(6, '0')}`;
}

export function parseLyricsTimestamp(value: string): number | null {
  const normalized = value.trim().replace(/^\[/, '').replace(/\]$/, '');
  const match = /^(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?$/.exec(normalized);
  if (!match) return null;
  return timestampFromMatch(match);
}

export function serializeLyrics(lines: EditableLyricLine[]): string {
  return lines
    .map((line) => `${line.time === null ? '' : `[${formatLyricsTimestamp(line.time)}]`}${line.text}`)
    .join('\n')
    .replace(/\n+$/g, '');
}

export function remapLyricsToClip(raw: string, ranges: ClipRange[]): string {
  if (!raw || ranges.length === 0) return '';
  const lines = parseLyricsForEditor(raw);
  let outputOffset = 0;
  const remapped: EditableLyricLine[] = [];

  for (const range of ranges) {
    for (const line of lines) {
      if (line.time === null) continue;
      const isLastRange = range === ranges.at(-1);
      if (line.time >= range.start && (line.time < range.end || (isLastRange && line.time === range.end))) {
        remapped.push({ ...line, time: outputOffset + line.time - range.start });
      }
    }
    outputOffset += Math.max(0, range.end - range.start);
  }

  if (remapped.length === 0 && lines.every((line) => line.time === null)) return serializeLyrics(lines);
  return serializeLyrics(remapped);
}
