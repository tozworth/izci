import { describe, expect, it } from 'vitest';
import { supportsDocumentPictureInPicture } from './document-pip';

describe('supportsDocumentPictureInPicture', () => {
  it('detects the requestWindow capability', () => {
    expect(supportsDocumentPictureInPicture({
      documentPictureInPicture: { requestWindow: async () => ({}) as Window }
    } as unknown as Window)).toBe(true);
  });

  it('rejects absent and incomplete implementations', () => {
    expect(supportsDocumentPictureInPicture(undefined)).toBe(false);
    expect(supportsDocumentPictureInPicture({} as Window)).toBe(false);
  });
});
