import type { ClipRange } from './clip-audio';
import {
  parseLyricsForEditor,
  serializeLyrics,
  type EditableLyricLine
} from '$lib/utils/timestamped-lyrics';

export {
  formatLyricsTimestamp,
  parseLyricsForEditor,
  parseLyricsTimestamp,
  serializeLyrics,
  type EditableLyricLine
} from '$lib/utils/timestamped-lyrics';

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
