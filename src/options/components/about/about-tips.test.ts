import { describe, expect, it, vi } from 'vitest';
import en from '../../../lib/i18n/locales/en.json';
import tr from '../../../lib/i18n/locales/tr.json';
import { ABOUT_TIPS, createAboutTipRotation, splitTipEmphasis } from './about-tips';

describe('About tips', () => {
  it('exhausts each shuffled round and never repeats across round boundaries', () => {
    let calls = 0;
    // Force the second shuffle to put the previous entry at its draw end.
    const random = vi.fn(() => calls++ === ABOUT_TIPS.length - 1 ? 0 : 0.999);
    const next = createAboutTipRotation(random);
    let previous: ReturnType<typeof next> | undefined;

    for (let round = 0; round < 5; round += 1) {
      const seen = new Set<string>();
      for (let entry = 0; entry < ABOUT_TIPS.length; entry += 1) {
        const tip = next();
        expect(tip).not.toBe(previous);
        expect(seen.has(tip.id)).toBe(false);
        seen.add(tip.id);
        previous = tip;
      }
      expect(seen).toEqual(new Set(ABOUT_TIPS.map((tip) => tip.id)));
      // Only shuffling uses randomness; page entries consume the existing order.
      expect(random).toHaveBeenCalledTimes((round + 1) * (ABOUT_TIPS.length - 1));
    }
  });

  it('has English and Turkish content for all sixteen tips and five facts', () => {
    expect(ABOUT_TIPS.filter((tip) => tip.kind === 'tip')).toHaveLength(16);
    expect(ABOUT_TIPS.filter((tip) => tip.kind === 'fact')).toHaveLength(5);
    for (const tip of ABOUT_TIPS) {
      expect(en.options.about.tips[tip.id]).toBeTruthy();
      expect(tr.options.about.tips[tip.id]).toBeTruthy();
    }
  });

  it('preserves text and extracts the requested bold and italic emphasis', () => {
    expect(splitTipEmphasis('Try **Playback > Restore playback** or the *only* theme.')).toEqual([
      { text: 'Try ', emphasis: 'none' },
      { text: 'Playback > Restore playback', emphasis: 'strong' },
      { text: ' or the ', emphasis: 'none' },
      { text: 'only', emphasis: 'em' },
      { text: ' theme.', emphasis: 'none' }
    ]);
    expect(splitTipEmphasis('izci contains bugs.')).toEqual([
      { text: 'izci contains bugs.', emphasis: 'none' }
    ]);
  });
});
