import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackItem } from '$lib/types';

const audioBus = vi.hoisted(() => ({
  connectHtmlMediaElement: vi.fn(() => null),
  disconnect: vi.fn(),
  resume: vi.fn(async () => false),
  setSourceGain: vi.fn()
}));

vi.mock('$lib/services/audio-bus', () => ({ audioBusService: audioBus }));
vi.mock('$lib/services/logging', () => ({
  logDebug: vi.fn(),
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarning: vi.fn()
}));

import { VideoPlayerService } from './video-player';

type VideoEvent =
  | 'durationchange'
  | 'ended'
  | 'error'
  | 'loadedmetadata'
  | 'pause'
  | 'playing'
  | 'seeked'
  | 'timeupdate'
  | 'waiting';

class FakeVideoElement {
  readonly listeners = new Map<string, Array<() => void>>();
  preload = '';
  playsInline = false;
  controls = false;
  disablePictureInPicture = false;
  defaultPlaybackRate = 1;
  playbackRate = 1;
  preservesPitch = true;
  currentTime = 0;
  duration = 120;
  volume = 1;
  ended = false;
  error: MediaError | null = null;
  src = '';

  addEventListener(type: string, listener: () => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type: VideoEvent): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }

  load = vi.fn();
  pause = vi.fn();
  play = vi.fn(async () => undefined);
  remove = vi.fn();
  removeAttribute = vi.fn((name: string) => {
    if (name === 'src') this.src = '';
  });
  setAttribute = vi.fn();
}

const track: TrackItem = {
  id: 'video-1',
  name: 'Fallback video',
  extension: 'mp4',
  kind: 'video',
  size: 1_200_000,
  lastModified: 1,
  objectUrl: 'blob:test-video'
};

describe('VideoPlayerService', () => {
  let element: FakeVideoElement;

  beforeEach(() => {
    vi.clearAllMocks();
    element = new FakeVideoElement();
    vi.stubGlobal('document', {
      createElement: vi.fn(() => element),
      pictureInPictureEnabled: false,
      pictureInPictureElement: null
    });
  });

  it('settles loading and uses native volume when media-element adoption is unavailable', async () => {
    const onSnapshot = vi.fn();
    const service = new VideoPlayerService(onSnapshot, vi.fn(), vi.fn());
    service.setFallbackVolume(0.4);

    const ready = service.load(track);
    element.emit('loadedmetadata');
    await ready;

    expect(audioBus.connectHtmlMediaElement).toHaveBeenCalledWith(element);
    expect(element.volume).toBe(0.4);
    expect(onSnapshot).toHaveBeenLastCalledWith({ state: 'paused', error: undefined });
  });
});
