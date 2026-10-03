let catalogPromise: Promise<Record<string, object>> | null = null;

export interface MilkDropPresetInfo {
  name: string;
  author: string | null;
}

export function getMilkDropPresetInfo(preset: string): MilkDropPresetInfo {
  const separator = preset.indexOf(' - ');
  if (separator < 0) return { name: preset.trim(), author: null };
  const author = preset.slice(0, separator).trim();
  const name = preset.slice(separator + 3).trim();
  return name && author ? { name, author } : { name: preset.trim(), author: null };
}

// Equations are compiled by Vite into ordinary functions so desktop CSP does
// not need unsafe-eval. This lazy local JS chunk is also precached by the PWA.
export function loadMilkDropPresets(): Promise<Record<string, object>> {
  if (!catalogPromise) {
    catalogPromise = import('virtual:milkdrop-presets')
      .then(({ default: presets }) => presets)
      .catch((error) => {
        catalogPromise = null;
        throw error;
      });
  }
  return catalogPromise;
}

export function chooseMilkDropPreset(
  names: readonly string[],
  requested: string,
  current: string | null,
  random = Math.random
): string | null {
  if (requested && names.includes(requested)) return requested;
  const candidates = names.filter((name) => name !== current);
  const available = candidates.length ? candidates : names;
  return available[Math.min(available.length - 1, Math.floor(random() * available.length))] ?? null;
}
