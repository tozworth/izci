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
      presets: [{ id: 'one', name: 'My Rack', settings: { effects: [] } }]
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

  it('keeps global Raf bypass outside presets and dirty tracking', () => {
    const preset = rafPresets.create('Rack only');
    expect(preset?.settings).toEqual({ effects: [] });

    rafSettings.setEnabled(false);
    expect(isRafPresetDirty(rafPresets.getSnapshot(), rafSettings.getSnapshot())).toBe(false);

    rafSettings.addEffect('stereo-width');
    rafPresets.apply(preset!.id);
    expect(rafSettings.getSnapshot()).toEqual({ enabled: false, effects: [] });
  });

  it('persists palette colors independently of rack edits and rejects unknown colors', () => {
    const preset = rafPresets.create('Cute')!;
    const settings = rafSettings.getSnapshot();
    rafPresets.setColor(preset.id, 'magenta');
    const state = normalizeRafPresetState(JSON.parse(JSON.stringify(rafPresets.getSnapshot())));
    expect(state.presets[0].color).toBe('magenta');
    expect(isRafPresetDirty(state, settings)).toBe(false);
    rafPresets.rename(preset.id, 'Still cute');
    rafPresets.save();
    rafPresets.apply(preset.id);
    expect(rafPresets.getSnapshot().presets[0].color).toBe('magenta');
    expect(rafSettings.getSnapshot()).toEqual(settings);
    expect(normalizeRafPresetState({ presets: [{ ...preset, color: 'chartreuse' }] }).presets[0].color).toBeUndefined();
    expect(rafPresets.setColor(preset.id)?.color).toBeUndefined();
  });

  it('keeps icon choices outside rack edits and preserves them across preset operations', () => {
    const preset = rafPresets.create('Favorite')!;
    rafPresets.setColor(preset.id, 'magenta');
    rafPresets.setIcon(preset.id, 'favorite');
    const state = normalizeRafPresetState(JSON.parse(JSON.stringify(rafPresets.getSnapshot())));
    expect(state.presets[0]).toMatchObject({ icon: 'favorite', color: 'magenta' });
    expect(isRafPresetDirty(state, rafSettings.getSnapshot())).toBe(false);

    rafPresets.rename(preset.id, 'Heart');
    rafSettings.addEffect('stereo-width');
    rafPresets.save();
    rafSettings.clearEffects();
    rafPresets.apply(preset.id);
    expect(rafSettings.getSnapshot().effects).toHaveLength(1);
    expect(rafPresets.getSnapshot().presets[0]).toMatchObject({ icon: 'favorite', color: 'magenta' });
    expect(normalizeRafPresetState({ presets: [{ ...preset, icon: 'unknown_symbol' }] }).presets[0].icon).toBeUndefined();
    expect(rafPresets.setIcon(preset.id, 'unknown_symbol' as never)).toBeNull();
    expect(rafPresets.getSnapshot().presets[0].icon).toBe('favorite');
    expect(rafPresets.setIcon(preset.id)?.icon).toBeUndefined();
    expect(rafPresets.getSnapshot().presets[0].color).toBe('magenta');
  });
});
