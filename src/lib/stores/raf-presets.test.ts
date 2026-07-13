import { beforeEach, describe, expect, it } from 'vitest';
import { rafSettings } from './raf-settings';
import {
  DEFAULT_RAF_PRESET_STATE,
  isRafPresetDirty,
  normalizeRafPresetState,
  rafPresets
} from './raf-presets';

describe('Raf presets', () => {
  beforeEach(() => {
    rafSettings.reset();
    rafPresets.reset();
  });

  it('normalizes names, racks, selection, and duplicate IDs', () => {
    expect(normalizeRafPresetState(null)).toEqual(DEFAULT_RAF_PRESET_STATE);
    expect(normalizeRafPresetState({
      selectedPresetId: 'one',
      presets: [
        { id: 'one', name: '  My   Rack  ', settings: { enabled: false, effects: [] } },
        { id: 'one', name: 'Duplicate', settings: { enabled: true, effects: [] } },
        { id: 'bad', name: '   ', settings: {} }
      ]
    })).toEqual({
      selectedPresetId: 'one',
      presets: [{ id: 'one', name: 'My Rack', settings: { enabled: false, effects: [] } }]
    });
  });

  it('sorts preset names alphabetically with numeric prefixes in natural order', () => {
    const state = normalizeRafPresetState({
      selectedPresetId: null,
      presets: [
        { id: 'three', name: '3 MAX slop', settings: { enabled: true, effects: [] } },
        { id: 'two', name: '2 mid slop', settings: { enabled: true, effects: [] } },
        { id: 'one', name: '1 light slop', settings: { enabled: true, effects: [] } },
        { id: 'alpha', name: 'Airy', settings: { enabled: true, effects: [] } }
      ]
    });

    expect(state.presets.map((preset) => preset.name)).toEqual([
      '1 light slop',
      '2 mid slop',
      '3 MAX slop',
      'Airy'
    ]);
  });

  it('creates, detects edits, saves, reapplies, renames, and deletes a preset', () => {
    const preset = rafPresets.create('Clean');
    expect(preset).not.toBeNull();
    expect(isRafPresetDirty(rafPresets.getSnapshot(), rafSettings.getSnapshot())).toBe(false);

    rafSettings.addEffect('stereo-width');
    expect(isRafPresetDirty(rafPresets.getSnapshot(), rafSettings.getSnapshot())).toBe(true);
    rafPresets.save();
    expect(isRafPresetDirty(rafPresets.getSnapshot(), rafSettings.getSnapshot())).toBe(false);

    rafSettings.clearEffects();
    rafPresets.apply(preset!.id);
    expect(rafSettings.getSnapshot().effects).toHaveLength(1);
    expect(rafPresets.rename(preset!.id, 'Wide')?.name).toBe('Wide');
    expect(rafPresets.delete(preset!.id)).toEqual(DEFAULT_RAF_PRESET_STATE);
  });
});
