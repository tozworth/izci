import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_VISUALIZER_SETTINGS, normalizeVisualizerSettings, visualizerSettings } from './visualizer-settings';

afterEach(() => visualizerSettings.reset());

describe('visualizer settings', () => {
  it('keeps MilkDrop selection and configuration through serialization', () => {
    const settings = visualizerSettings.update({
      style: 'milkdrop', milkDropPreset: '  My preset  ', milkDropCyclePresets: false,
      milkDropCycleSeconds: 90, milkDropBlendSeconds: 1.25, milkDropResolution: 0.5
    });
    expect(normalizeVisualizerSettings(JSON.parse(JSON.stringify(settings)))).toMatchObject({
      style: 'milkdrop', milkDropPreset: 'My preset', milkDropCyclePresets: false,
      milkDropCycleSeconds: 90, milkDropBlendSeconds: 1.25, milkDropResolution: 0.5
    });
    // Switching styles keeps each style's preferences in the shared store.
    visualizerSettings.update({ style: 'triangles' });
    expect(visualizerSettings.getSnapshot().milkDropResolution).toBe(0.5);
  });

  it('bounds expensive rendering and timing settings and rejects malformed values', () => {
    expect(normalizeVisualizerSettings({
      style: 'invalid', milkDropPreset: {}, milkDropCyclePresets: 'false',
      milkDropCycleSeconds: -1, milkDropBlendSeconds: Infinity, milkDropResolution: 99,
      triangleMinSize: 0.8, triangleMaxSize: 0.1
    })).toMatchObject({
      style: DEFAULT_VISUALIZER_SETTINGS.style, milkDropPreset: '', milkDropCyclePresets: true,
      milkDropCycleSeconds: 5, milkDropBlendSeconds: DEFAULT_VISUALIZER_SETTINGS.milkDropBlendSeconds,
      milkDropResolution: 2, triangleMinSize: 0.8, triangleMaxSize: 0.8
    });
  });
});
