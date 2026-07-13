import { describe, expect, it } from 'vitest';
import { CRYSTALIZER_FREQUENCIES } from './raf-effects/crystalizer';
import { GRAPHIC_EQ_FREQUENCIES } from './raf-effects/graphic-eq';
import { mapSlopToParameters } from './raf-effects/sloptimizer';
import { RAF_EFFECT_DEFINITIONS, RAF_EFFECT_REGISTRY } from './raf-effect-registry';

describe('Raf effect registry', () => {
  it('declares the built-ins with independent defaults', () => {
    expect(RAF_EFFECT_DEFINITIONS.map((definition) => definition.type)).toEqual([
      'graphic-eq',
      'stereo-width',
      'crystalizer',
      'sloptimizer'
    ]);
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
      ...mapSlopToParameters(0)
    });
  });
});
