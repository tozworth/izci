import { describe, expect, it } from 'vitest';
import { applyMetadataPatch } from './media-metadata/merge';
import { readMetadataDocument } from './media-metadata/reader';
import { remuxMetadataToBlob } from './media-metadata/remux';
import { readBrowserHostTrackInfo, readLoadedTrackInfo } from './multiplayer-track-info';
import { enrichCatalog, enrichPlayback } from './multiplayer-client-track-info';
import type { TrackItem } from '$lib/types';

const OPUS_FIXTURE = 'T2dnUwACAAAAAAAAAAC3Hb/zAAAAAGrcH6cBE09wdXNIZWFkAQE4AUAfAAAAAABPZ2dTAAAAAAAAAAAAALcdv/MBAAAAttW46AE8T3B1c1RhZ3MMAAAATGF2ZjYyLjEuMTAwAQAAABwAAABlbmNvZGVyPUxhdmM2Mi4zLjEwMSBsaWJvcHVzT2dnUwAEmAoAAAAAAAC3Hb/zAgAAAL7lPgwDBwYGCAvmOyOrYAgIrLMOxggIrLMOxg==';

describe('multiplayer track info', () => {
  it('reads embedded tags and lyrics from a browser-hosted source', async () => {
    const bytes = Uint8Array.from(atob(OPUS_FIXTURE), (character) => character.charCodeAt(0));
    const source = new File([bytes], 'song.opus', { lastModified: 123 });
    const document = await readMetadataDocument(source, 'opus');
    const tagged = applyMetadataPatch(document, {
      title: 'Tagged title', artist: 'Tagged artist', album: 'Tagged album',
      lyrics: '[00:01.00]First line\n[00:02.00]Second line'
    });
    const blob = await remuxMetadataToBlob(source, 'opus', tagged.tags);
    const file = new File([blob], source.name, { lastModified: 123 });
    const track: TrackItem = { id: 'song', name: file.name, extension: 'opus', kind: 'stream', size: file.size, lastModified: 123, file };

    const info = await readLoadedTrackInfo(track);

    expect(info.metadata).toMatchObject({ title: 'Tagged title', artist: 'Tagged artist', album: 'Tagged album' });
    expect(info.lyrics).toContain('[00:01.00]First line');
    expect((await readBrowserHostTrackInfo(track)).lyrics).toBe(info.lyrics);
  });

  it('applies fetched metadata to the remote catalog and playback', () => {
    const track: TrackItem = { id: 'song', name: 'song.opus', extension: 'opus', kind: 'stream', size: 1, lastModified: 1 };
    const info = { trackId: 'song', metadata: { title: 'Tagged title', replayGain: { trackGainDb: -5 } }, lyrics: null };
    const map = new Map([['song', info]]);
    const catalog = enrichCatalog({ revision: 1, queue: [track], library: [track], favorites: [], shuffleEnabled: false, repeatMode: 'off' }, map);
    const playback = enrichPlayback({ generationId: 'g1', snapshot: { state: 'paused', currentTime: 0, duration: 0, volume: 1, muted: false, backend: null }, track, sentAt: 0 }, map);

    expect(catalog.queue[0].metadata).toEqual(info.metadata);
    expect(catalog.library[0].metadata).toEqual(info.metadata);
    expect(playback.track?.metadata).toEqual(info.metadata);
  });
});
