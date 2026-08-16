import { describe, expect, it } from 'vitest';
import { GRAPHIC_EQ_FREQUENCIES } from './raf-effects/graphic-eq';
import { parseRafSettingsJson, serializeRafSettings } from './raf-settings-transfer';

describe('Raf settings transfer', () => {
  it('round-trips normalized rack settings', () => {
    const settings = {
      enabled: false,
      effects: [{
        id: 'eq-1',
        type: 'graphic-eq' as const,
        enabled: true,
        dryWet: 100,
        preampDb: 3,
        bandGainsDb: GRAPHIC_EQ_FREQUENCIES.map(() => 2)
      }]
    };

    expect(parseRafSettingsJson(serializeRafSettings(settings))).toEqual(settings);
  });

  it('rejects invalid JSON and non-rack payloads', () => {
    expect(() => parseRafSettingsJson('{')).toThrow('not valid JSON');
    expect(() => parseRafSettingsJson('{}')).toThrow('valid Raf rack settings');
  });

  it('rejects payloads containing malformed or unsupported effects', () => {
    expect(() => parseRafSettingsJson(JSON.stringify({
      enabled: true,
      effects: [{ id: 'future', type: 'future-effect', enabled: true }]
    }))).toThrow('unsupported or malformed effect');
  });
});
