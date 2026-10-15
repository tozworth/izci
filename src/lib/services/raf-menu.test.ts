import { afterEach, describe, expect, it } from 'vitest';
import { rafPresets } from '$lib/stores/raf-presets';
import { rafSettings } from '$lib/stores/raf-settings';
import { buildRafMenuItems, runRafMenuAction } from './raf-menu';

afterEach(() => {
  rafPresets.reset();
  rafSettings.reset();
});

function presetMenuItem(id: string) {
  return buildRafMenuItems({
    translate: (key) => String(key),
    rafSettings: rafSettings.getSnapshot(),
    rafPresets: rafPresets.getSnapshot()
  }).find((item) => item.id === `applyRafPreset:${id}`)!;
}

describe('Raf preset menu actions', () => {
  it('bypasses the active preset without discarding rack edits, then enables it again', () => {
    rafSettings.setEnabled(true);
    const preset = rafPresets.create('Selected rack')!;
    rafSettings.addEffect('graphic-eq');
    const editedEffects = rafSettings.getSnapshot().effects;
    expect(presetMenuItem(preset.id).checked).toBe(true);

    runRafMenuAction(`applyRafPreset:${preset.id}`, () => {});

    expect(rafSettings.getSnapshot()).toEqual({ enabled: false, effects: editedEffects });
    expect(rafPresets.getSnapshot().selectedPresetId).toBe(preset.id);
    expect(presetMenuItem(preset.id).checked).toBe(false);

    runRafMenuAction(`applyRafPreset:${preset.id}`, () => {});

    expect(rafSettings.getSnapshot()).toEqual({ enabled: true, effects: preset.settings.effects });
    expect(presetMenuItem(preset.id).checked).toBe(true);
  });

  it.each([false, true])('applies and enables a different preset when Raf enabled is %s', (enabled) => {
    rafSettings.addEffect('graphic-eq');
    const preset = rafPresets.create('Other rack')!;
    const selected = rafPresets.create('Selected rack')!;
    rafSettings.clearEffects();
    rafSettings.setEnabled(enabled);

    runRafMenuAction(`applyRafPreset:${preset.id}`, () => {});

    expect(rafSettings.getSnapshot()).toEqual({ enabled: true, effects: preset.settings.effects });
    expect(rafPresets.getSnapshot().selectedPresetId).toBe(preset.id);
    expect(presetMenuItem(preset.id).checked).toBe(true);
    expect(presetMenuItem(selected.id).checked).toBe(false);
  });
});
