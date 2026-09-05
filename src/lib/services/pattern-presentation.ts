interface PatternCellParts {
  note: string;
  instrument: string;
  volume: string;
  effect: string;
}

export function splitPatternCell(value: string): PatternCellParts {
  const formatted = value.padEnd(13, ' ');

  return {
    note: formatted.slice(0, 3).trim() || '...',
    instrument: formatted.slice(4, 6).trim() || '..',
    volume: formatted.slice(6, 9).trim() || '..',
    effect: formatted.slice(10, 13).trim() || '...'
  };
}

export function isPatternCellEmpty(value: string): boolean {
  return !/[^.\s]/.test(value);
}
