import { describe, expect, it } from 'vitest';
import { minimizeDocumentPipOpener, supportsDocumentPictureInPicture } from './document-pip';

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

describe('minimizeDocumentPipOpener', () => {
  it('minimizes a capable opener window', async () => {
    let minimizeCalls = 0;

    await expect(minimizeDocumentPipOpener({
      minimize: async () => {
        minimizeCalls += 1;
      }
    })).resolves.toBe(true);
    expect(minimizeCalls).toBe(1);
  });

  it('degrades when minimization is unavailable or denied', async () => {
    await expect(minimizeDocumentPipOpener(undefined)).resolves.toBe(false);
    await expect(minimizeDocumentPipOpener({
      minimize: async () => {
        throw new DOMException('Permission denied.', 'NotAllowedError');
      }
    })).resolves.toBe(false);
  });
});
