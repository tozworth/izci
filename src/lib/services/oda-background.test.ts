import { describe, expect, it } from 'vitest';
import { isOdaBackgroundImage } from './oda-background';

describe('isOdaBackgroundImage', () => {
  it('accepts image data URLs', () => {
    expect(isOdaBackgroundImage('data:image/jpeg;base64,/9j/')).toBe(true);
    expect(isOdaBackgroundImage('data:image/png;base64,iVBOR')).toBe(true);
  });

  it('rejects non-image or non-string values', () => {
    expect(isOdaBackgroundImage(null)).toBe(false);
    expect(isOdaBackgroundImage('blob:https://example/1')).toBe(false);
    expect(isOdaBackgroundImage('data:text/plain;base64,aGk=')).toBe(false);
  });
});
