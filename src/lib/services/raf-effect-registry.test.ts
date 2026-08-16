import { describe, expect, it } from 'vitest';
import { CRYSTALIZER_FREQUENCIES } from './raf-effects/crystalizer';
import { GRAPHIC_EQ_FREQUENCIES } from './raf-effects/graphic-eq';
import { mapSlopToParameters, SLOPTIMIZER_CROSSOVERS } from './raf-effects/sloptimizer';
import { RAF_EFFECT_DEFINITIONS, RAF_EFFECT_REGISTRY } from './raf-effect-registry';

describe('Raf effect registry', () => {
  it('declares the built-ins with independent defaults', () => {
    expect(RAF_EFFECT_DEFINITIONS.map((definition) => definition.type)).toEqual([
      'auto-amp',
      'graphic-eq',
      'stereo-width',
      'crystalizer',
      'sloptimizer',
      'reverb',
      'pitch'
    ]);
    expect(RAF_EFFECT_REGISTRY['auto-amp'].createDefault('amp')).toMatchObject({
      id: 'amp',
      type: 'auto-amp',
      gainDb: 0,
      mode: 'off',
      targetDb: -1,
      lookaheadMs: 150
    });
    const first = RAF_EFFECT_REGISTRY['graphic-eq'].createDefault('first');
    const second = RAF_EFFECT_REGISTRY['graphic-eq'].createDefault('second');
    expect(first).toMatchObject({ id: 'first', enabled: true, preampDb: 0 });
    expect(first.type === 'graphic-eq' && first.bandGainsDb).toHaveLength(GRAPHIC_EQ_FREQUENCIES.length);
    expect(first).not.toBe(second);
    const crystalizer = RAF_EFFECT_REGISTRY.crystalizer.createDefault('crystalizer');
    expect(crystalizer.type === 'crystalizer' && crystalizer.bandIntensities).toEqual(
      CRYSTALIZER_FREQUENCIES.map(() => 0)
    );
    expect(RAF_EFFECT_REGISTRY.sloptimizer.createDefault('sloptimizer')).toMatchObject({
      id: 'sloptimizer',
      type: 'sloptimizer',
      advanced: false,
      slop: 0,
      customized: false,
      lowCrossoverHz: SLOPTIMIZER_CROSSOVERS[0],
      highCrossoverHz: SLOPTIMIZER_CROSSOVERS[1],
      ...mapSlopToParameters(0)
    });
    expect(RAF_EFFECT_REGISTRY.reverb.createDefault('reverb')).toMatchObject({
      id: 'reverb',
      type: 'reverb',
      mix: 18,
      roomSize: 55,
      decaySeconds: 2.2,
      preDelayMs: 18,
      dampingHz: 9_000
    });
    expect(RAF_EFFECT_REGISTRY.pitch.createDefault('pitch')).toMatchObject({
      id: 'pitch',
      type: 'pitch',
      enabled: true,
      semitones: 0
    });
  });
});
