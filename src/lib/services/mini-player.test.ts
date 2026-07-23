import { describe, expect, it } from 'vitest';
import { minimizeMiniPlayerOpener, supportsMiniPlayer } from './mini-player';

describe('supportsMiniPlayer', () => {
  it('detects the requestWindow capability', () => {
    expect(supportsMiniPlayer({
      documentPictureInPicture: { requestWindow: async () => ({}) as Window }
    } as unknown as Window)).toBe(true);
  });

  it('rejects absent and incomplete implementations', () => {
    expect(supportsMiniPlayer(undefined)).toBe(false);
    expect(supportsMiniPlayer({} as Window)).toBe(false);
  });
});

describe('minimizeMiniPlayerOpener', () => {
  it('minimizes a capable opener window', async () => {
    let minimizeCalls = 0;

    await expect(minimizeMiniPlayerOpener({
      minimize: async () => {
        minimizeCalls += 1;
      }
    })).resolves.toBe(true);
    expect(minimizeCalls).toBe(1);
  });

  it('degrades when minimization is unavailable or denied', async () => {
    await expect(minimizeMiniPlayerOpener(undefined)).resolves.toBe(false);
    await expect(minimizeMiniPlayerOpener({
      minimize: async () => {
        throw new DOMException('Permission denied.', 'NotAllowedError');
      }
    })).resolves.toBe(false);
  });
});
