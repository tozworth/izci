import { describe, expect, it, afterEach } from 'vitest';
import { normalizeNowPlayingState, nowPlayingState, moveNowPlayingTab } from './now-playing-state';
describe('Now Playing preferences', () => {
  afterEach(() => nowPlayingState.reset());
  it('normalizes and persists independent flyout widths', () => {
    expect(normalizeNowPlayingState({ leftWidth: NaN, rightWidth: 900 })).toMatchObject({ leftWidth: 400, rightWidth: 800 });
    nowPlayingState.update({ leftWidth: 320, rightWidth: 540 });
    expect(nowPlayingState.getSnapshot()).toMatchObject({ leftWidth: 320, rightWidth: 540 });
  });
  it('keeps contextual content out of flyouts and removes invalid or duplicate tabs', () => {
    expect(normalizeNowPlayingState({ leftTabs: ['queue', 'lyrics', 'patterns', 'queue', 'unknown'] }).leftTabs).toEqual(['queue']);
  });
  it('moves tabs without changing contextual preferences or pinning', () => {
    nowPlayingState.update({ lyrics: false, patterns: true, rightPinned: true });
    moveNowPlayingTab('queue', 'right');
    expect(nowPlayingState.getSnapshot()).toMatchObject({ lyrics: false, patterns: true, rightPinned: true, leftTabs: ['library'] });
    moveNowPlayingTab('queue', 'left');
    moveNowPlayingTab('queue', 'left');
    expect(nowPlayingState.getSnapshot().leftTabs).toEqual(['library', 'queue']);
  });
});
