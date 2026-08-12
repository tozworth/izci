import type { ModulePatternSong } from '$lib/contracts/module-playback';

export interface HivelyPatternData {
  channelCount: number;
  instrumentNames: string[];
  positionCount: number;
  positionTracks: Uint8Array;
  positionTransposes: Int8Array;
  steps: Uint8Array;
  subsongCount: number;
  trackCount: number;
  trackLength: number;
}

const STEP_FIELD_COUNT = 4;
const NOTE_NAMES = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'];

function formatNote(note: number, transpose: number): string {
  if (note === 0) return '...';
  const transposed = note + transpose;
  if (transposed < 1 || transposed > 60) return '???';
  const zeroBased = transposed - 1;
  return `${NOTE_NAMES[zeroBased % NOTE_NAMES.length]}${Math.floor(zeroBased / NOTE_NAMES.length) + 1}`;
}

function formatHex(value: number, width: number): string {
  return value.toString(16).toUpperCase().padStart(width, '0');
}

function formatCell(data: HivelyPatternData, track: number, transpose: number, row: number): string {
  const offset = (track * data.trackLength + row) * STEP_FIELD_COUNT;
  const note = data.steps[offset] ?? 0;
  const instrument = data.steps[offset + 1] ?? 0;
  const effect = data.steps[offset + 2] ?? 0;
  const effectParameter = data.steps[offset + 3] ?? 0;
  const formattedInstrument = instrument === 0 ? '..' : formatHex(instrument, 2);
  const formattedEffect = effect === 0 && effectParameter === 0
    ? '...'
    : `${formatHex(effect, 1)}${formatHex(effectParameter, 2)}`;

  // AHX/HVL steps have no separate volume column. Four spaces keep the
  // existing libopenmpt cell parser's volume slot empty.
  return `${formatNote(note, transpose)} ${formattedInstrument}    ${formattedEffect}`;
}

export function createHivelyPatternSong(data: HivelyPatternData): ModulePatternSong {
  const patterns: ModulePatternSong['patterns'] = [];
  const orders: ModulePatternSong['orders'] = [];
  const patternByLayout = new Map<string, number>();

  for (let position = 0; position < data.positionCount; position += 1) {
    const positionOffset = position * data.channelCount;
    const layout = Array.from({ length: data.channelCount }, (_, channel) => {
      const index = positionOffset + channel;
      return `${data.positionTracks[index] ?? 0}:${data.positionTransposes[index] ?? 0}`;
    }).join('|');
    let pattern = patternByLayout.get(layout);

    if (pattern === undefined) {
      pattern = patterns.length;
      patternByLayout.set(layout, pattern);
      patterns.push({
        name: `Position ${position}`,
        rows: Array.from({ length: data.trackLength }, (_, row) =>
          Array.from({ length: data.channelCount }, (_, channel) => {
            const index = positionOffset + channel;
            return formatCell(
              data,
              data.positionTracks[index] ?? 0,
              data.positionTransposes[index] ?? 0,
              row
            );
          })
        )
      });
    }

    orders.push({ name: `Position ${position}`, pat: pattern });
  }

  return {
    channels: Array.from({ length: data.channelCount }, () => ''),
    instruments: data.instrumentNames,
    samples: [],
    orders,
    patterns,
    numSubsongs: data.subsongCount
  };
}
