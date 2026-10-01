import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadEditorMetadata } from './editor-metadata';
import { buildId3Tag, EMPTY_TAGS } from './tag-writer';

const readers = vi.hoisted(() => ({ metadata: vi.fn(), artwork: vi.fn(), lyrics: vi.fn() }));
vi.mock('$lib/services/stream-artwork', () => ({ loadTrackMetadata: readers.metadata, loadEmbeddedStreamArtwork: readers.artwork }));
vi.mock('$lib/services/lyrics', () => ({ loadTrackLyrics: readers.lyrics }));

beforeEach(() => { for (const reader of Object.values(readers)) reader.mockReset().mockResolvedValue(null); });
afterEach(() => vi.restoreAllMocks());

describe('editor metadata loading', () => {
  it('reads MP3 tags without a second complete compressed-file read', async () => {
    const tag = await buildId3Tag({ ...EMPTY_TAGS, title: 'Tagged', artist: 'Artist' }, null);
    const file = new File([Uint8Array.from(tag), new Uint8Array(2 * 1024 * 1024)], 'fallback.mp3');
    const fullRead = vi.spyOn(file, 'arrayBuffer').mockRejectedValue(new Error('No full read'));
    const slices = vi.spyOn(file, 'slice');
    const metadata = await loadEditorMetadata(file, new AbortController().signal);
    expect(metadata.tags).toMatchObject({ title: 'Tagged', artist: 'Artist' });
    expect(fullRead).not.toHaveBeenCalled();
    expect(slices.mock.calls).toEqual([[0, 10], [0, tag.length]]);
  });

  it('retains successful tags when artwork or lyrics readers fail', async () => {
    readers.metadata.mockResolvedValue({ title: 'Title', album: 'Album', composer: 'Composer' });
    readers.artwork.mockRejectedValue(new Error('Damaged picture'));
    readers.lyrics.mockRejectedValue(new Error('Damaged lyrics'));
    const metadata = await loadEditorMetadata(new File(['fLaC'], 'Artist - Track.flac'), new AbortController().signal);
    expect(metadata.tags).toMatchObject({ title: 'Title', artist: 'Artist', album: 'Album', composer: 'Composer' });
    expect(metadata.artwork).toBeNull();
  });

  it('skips stream metadata for modules and discards aborted reader completions', async () => {
    const signal = new AbortController().signal;
    const metadata = await loadEditorMetadata(new File(['module'], 'Artist - Tune.xm'), signal);
    expect(metadata.tags).toMatchObject({ title: 'Tune', artist: 'Artist' });
    expect(readers.metadata).not.toHaveBeenCalled();
    const controller = new AbortController();
    const pending = loadEditorMetadata(new File(['audio'], 'Track.flac'), controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
