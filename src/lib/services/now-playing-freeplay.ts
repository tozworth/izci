export type FreeplayFloaterEdge = 'left' | 'right' | 'top' | 'bottom';

export interface FreeplayFloaterPlacement {
  edge: FreeplayFloaterEdge;
  offsetPercent: number;
  driftX: number;
  driftY: number;
  rotation: number;
  durationSeconds: number;
  delaySeconds: number;
}

function hashText(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function unit(seed: number, salt: number): number {
  let value = (seed + Math.imul(salt, 0x9e3779b1)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0xffffffff;
}

/** Places cards only in the outer bands, leaving the centered artwork/lyrics stage clear. */
export function createFreeplayFloaterPlacement(
  clientId: string,
  ordinal: number,
  sessionSeed = 0
): FreeplayFloaterPlacement {
  const seed = hashText(`${clientId}:${sessionSeed}`);
  const edges: FreeplayFloaterEdge[] = ['left', 'right', 'top', 'bottom'];
  const edge = edges[(seed + ordinal) % edges.length] ?? 'left';
  const offsetBands = edge === 'left' || edge === 'right'
    ? [11, 29, 54, 76]
    : [6, 27, 58, 78];
  const band = offsetBands[(Math.floor(seed / 4) + ordinal) % offsetBands.length] ?? 11;

  return {
    edge,
    offsetPercent: Math.min(82, Math.max(5, band + (unit(seed, 1) - 0.5) * 7)),
    driftX: 2.5 + unit(seed, 2) * 4,
    driftY: 2 + unit(seed, 3) * 4,
    rotation: (unit(seed, 4) - 0.5) * 2.4,
    durationSeconds: 8 + unit(seed, 5) * 5,
    delaySeconds: -unit(seed, 6) * 8
  };
}

export function getFreeplayClientIcon(platform: string): string {
  const normalized = platform.toLowerCase();
  if (/android|iphone|ios|mobile|phone/.test(normalized)) return 'smartphone';
  if (/ipad|tablet/.test(normalized)) return 'tablet_mac';
  return 'computer';
}
