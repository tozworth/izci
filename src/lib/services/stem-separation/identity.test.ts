import { describe, expect, it } from 'vitest';
import { createStemResultKey, createStemSourceQuickKey, digestBytes } from './identity';

describe('stem cache identity', () => {
  it('uses source hints without relying on playlist identity', () => {
    expect(
      createStemSourceQuickKey({
        id: 'playlist-copy',
        path: 'Music/Album/song.flac',
        name: 'song.flac',
        size: 123,
        lastModified: 456
      })
    ).toBe(
      'Music/Album/song.flac\u0000song.flac\u0000123\u0000456'
    );
  });

  it('produces stable SHA-256 result identities', async () => {
    const sourceDigest = await digestBytes(new TextEncoder().encode('audio').buffer);
    expect(sourceDigest).toHaveLength(64);
    expect(await createStemResultKey(sourceDigest)).toBe(await createStemResultKey(sourceDigest));
    expect(await createStemResultKey(sourceDigest)).not.toBe(await createStemResultKey('different'));
  });
});
