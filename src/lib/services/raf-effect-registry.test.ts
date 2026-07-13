import { describe, expect, it } from 'vitest';
import { GRAPHIC_EQ_FREQUENCIES } from './raf-effects/graphic-eq';
import { RAF_EFFECT_DEFINITIONS, RAF_EFFECT_REGISTRY } from './raf-effect-registry';

describe('Raf effect registry', () => {
  it('declares the Phase 0 built-ins with independent defaults', () => {
    expect(RAF_EFFECT_DEFINITIONS.map((definition) => definition.type)).toEqual(['graphic-eq', 'stereo-width']);
    const first = RAF_EFFECT_REGISTRY['graphic-eq'].createDefault('first');
    const second = RAF_EFFECT_REGISTRY['graphic-eq'].createDefault('second');
    expect(first).toMatchObject({ id: 'first', enabled: true, preampDb: 0 });
    expect(first.type === 'graphic-eq' && first.bandGainsDb).toHaveLength(GRAPHIC_EQ_FREQUENCIES.length);
    expect(first).not.toBe(second);
  });
});
