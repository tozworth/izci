import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TrackItem } from '$lib/types';
import {
  listenForCurrentToolTrack,
  OPEN_CURRENT_TOOL_TRACK_MESSAGE,
  respondToToolTrackRequest
} from './tool-track-context';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('tool track context', () => {
  it('responds to a same-origin request with the materialized current track', () => {
    const postMessage = vi.fn();
    const file = new File(['audio'], 'song.mp3', { type: 'audio/mpeg' });
    const track: TrackItem = {
      id: 'track',
      file,
      name: file.name,
      extension: 'mp3',
      kind: 'stream',
      size: file.size,
      lastModified: file.lastModified
    };
    vi.stubGlobal('window', { location: { origin: 'https://izci.test' } });

    const handled = respondToToolTrackRequest({
      origin: 'https://izci.test',
      data: { type: 'izci:request-tool-track' },
      source: { postMessage }
    } as unknown as MessageEvent, track);

    expect(handled).toBe(true);
    expect(postMessage).toHaveBeenCalledWith({
      type: 'izci:tool-track',
      track: {
        file,
        fileHandle: undefined,
        path: undefined,
        extension: 'mp3',
        kind: 'stream'
      }
    }, 'https://izci.test');
  });

  it('requests again when an existing tool window is reopened', () => {
    let messageListener: ((event: MessageEvent) => void) | null = null;
    const opener = { closed: false, postMessage: vi.fn() };
    const onTrack = vi.fn();
    vi.stubGlobal('window', {
      opener,
      location: { origin: 'https://izci.test' },
      addEventListener: (_type: string, listener: (event: MessageEvent) => void) => {
        messageListener = listener;
      },
      removeEventListener: vi.fn()
    });

    const stop = listenForCurrentToolTrack(onTrack);
    expect(opener.postMessage).toHaveBeenCalledTimes(1);

    expect(messageListener).not.toBeNull();
    (messageListener as unknown as (event: MessageEvent) => void)({
      origin: 'https://izci.test',
      source: opener,
      data: { type: OPEN_CURRENT_TOOL_TRACK_MESSAGE }
    } as unknown as MessageEvent);

    expect(opener.postMessage).toHaveBeenCalledTimes(2);
    expect(onTrack).not.toHaveBeenCalled();
    stop();
  });
});
