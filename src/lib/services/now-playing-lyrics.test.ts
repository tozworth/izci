import { describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { TrackItem } from '$lib/types';
vi.mock('./lyrics', () => ({ getTrackLyricsLoadKey: (track: TrackItem | null) => track?.id ?? '', loadTrackLyrics: vi.fn() }));
import { loadTrackLyrics } from './lyrics';
import { createNowPlayingLyrics } from './now-playing-lyrics';
describe('Now Playing lyric availability', () => {
  it('ignores a previous track resolving after the next track', async () => {
    let finish!: (value: any) => void;
    vi.mocked(loadTrackLyrics).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(null);
    const state = createNowPlayingLyrics();
    state.setTrack({ id: 'first' } as TrackItem);
    state.setTrack({ id: 'second' } as TrackItem);
    await Promise.resolve();
    finish({ raw: 'old lyrics', lines: [] });
    await Promise.resolve();
    expect(get(state)).toBe(false);
    state.destroy();
  });
});
