import { describe, expect, it } from 'vitest';
import { chooseMilkDropPreset, getMilkDropPresetInfo, loadMilkDropPresets } from './milkdrop-presets';

describe('MilkDrop preset selection', () => {
  it('separates author credits while preserving remixes and names without credits', () => {
    expect(getMilkDropPresetInfo('Flexi + Martin - astral projection')).toEqual({
      name: 'astral projection', author: 'Flexi + Martin'
    });
    expect(getMilkDropPresetInfo(' Aderrasi - Storm of the Eye - mash0000 ')).toEqual({
      name: 'Storm of the Eye - mash0000', author: 'Aderrasi'
    });
    expect(getMilkDropPresetInfo(' sawtooth grin roam ')).toEqual({ name: 'sawtooth grin roam', author: null });
    expect(getMilkDropPresetInfo(' - untitled')).toEqual({ name: '- untitled', author: null });
  });

  it('loads the bundled virtual catalog with callable equations instead of runtime source strings', async () => {
    const presets = await loadMilkDropPresets();
    expect(Object.keys(presets)).toHaveLength(100);
    for (const preset of Object.values(presets)) {
      expect(preset).toHaveProperty('init_eqs', expect.any(Function));
      expect(preset).toHaveProperty('frame_eqs', expect.any(Function));
      expect(preset).not.toHaveProperty('init_eqs_str');
    }
  });

  it('uses an explicit preset and recovers from an unavailable name', () => {
    expect(chooseMilkDropPreset(['a', 'b'], 'a', 'b')).toBe('a');
    expect(chooseMilkDropPreset(['a', 'b'], 'missing', 'a', () => 0)).toBe('b');
  });

  it('never immediately repeats while cycling and handles small catalogs', () => {
    expect(chooseMilkDropPreset(['a', 'b', 'c'], '', 'b', () => 0.9)).toBe('c');
    expect(chooseMilkDropPreset(['a'], '', 'a')).toBe('a');
    expect(chooseMilkDropPreset([], '', null)).toBeNull();
  });
});
