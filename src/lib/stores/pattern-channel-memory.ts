import { createPersistentStore } from './persistent-store';

export interface RememberedPatternChannel {
  muted: boolean;
  solo: boolean;
}

export type PatternChannelMemory = Record<string, RememberedPatternChannel[]>;

export function normalizePatternChannelMemory(value: unknown): PatternChannelMemory {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, channels]) => {
    if (!key || !Array.isArray(channels)) return [];
    return [[key, channels.map((entry: unknown) => {
      const source = entry && typeof entry === 'object' ? entry as Partial<RememberedPatternChannel> : {};
      const muted = source.muted === true;
      return { muted, solo: !muted && source.solo === true };
    })]];
  }));
}

export function createPatternChannelMemory() {
  return createPersistentStore<PatternChannelMemory>({
    storageKey: 'izci.pattern-channel-memory',
    channelName: 'izci.pattern-channel-memory',
    defaultValue: {},
    normalize: normalizePatternChannelMemory
  });
}

export const patternChannelMemory = createPatternChannelMemory();
