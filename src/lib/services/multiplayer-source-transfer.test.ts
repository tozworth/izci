import { describe, expect, it } from 'vitest';
import { parseSourceFileFrame } from './multiplayer-source-transfer';

describe('multiplayer source transfer frames', () => {
  it('ties a source file to the delivery generation', () => {
    expect(parseSourceFileFrame(JSON.stringify({
      kind: 'file.begin',
      transferId: 'transfer',
      trackId: 'track',
      generationId: 'generation',
      name: 'track.flac',
      type: 'audio/flac',
      size: 10,
      lastModified: 1
    }))).toMatchObject({ trackId: 'track', generationId: 'generation' });
  });

  it('rejects legacy and unbounded generation-less frames', () => {
    expect(parseSourceFileFrame(JSON.stringify({
      kind: 'file.begin', transferId: 'transfer', trackId: 'track', name: 'track.flac',
      type: 'audio/flac', size: 10, lastModified: 1
    }))).toBeNull();
  });
});
