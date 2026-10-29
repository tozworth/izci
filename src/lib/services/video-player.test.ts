import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackItem } from '$lib/types';

const audioBus = vi.hoisted(() => ({
  connectHtmlMediaElement: vi.fn<() => MediaElementAudioSourceNode | null>(() => null),
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

  it('reports ended state and invokes the end handler when playback finishes', async () => {
    const onEnded = vi.fn();
    const onSnapshot = vi.fn();
    const service = new VideoPlayerService(onSnapshot, vi.fn(), onEnded);

    const ready = service.load(track);
    element.emit('loadedmetadata');
    await ready;

    element.currentTime = element.duration;
    element.ended = true;
    element.emit('ended');

    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(onSnapshot).toHaveBeenCalledWith({
      error: undefined,
      currentTime: 120,
      duration: 120
    });
    expect(onSnapshot).toHaveBeenLastCalledWith({ state: 'ended', error: undefined });
  });

  it('keeps picture-in-picture open while replacing the video source, and exits on unload', async () => {
    const exitPictureInPicture = vi.fn(async () => undefined);
    vi.stubGlobal('document', {
      createElement: vi.fn(() => element),
      pictureInPictureEnabled: true,
      pictureInPictureElement: element,
      exitPictureInPicture
    });
    const service = new VideoPlayerService(vi.fn(), vi.fn(), vi.fn());
    const first = service.load(track);
    element.emit('loadedmetadata');
    await first;
    element.removeAttribute.mockClear();

    const second = service.load({ ...track, id: 'video-2', objectUrl: 'blob:second-video' });
    expect(element.src).toBe('blob:second-video');
    expect(exitPictureInPicture).not.toHaveBeenCalled();
    expect(element.removeAttribute).not.toHaveBeenCalled();
    element.emit('loadedmetadata');
    await second;

    service.unload();
    expect(exitPictureInPicture).toHaveBeenCalledOnce();
    expect(element.removeAttribute).toHaveBeenCalledWith('src');
  });

  it('rejects the pending load and reports an error when the element fails', async () => {
    const onSnapshot = vi.fn();
    const service = new VideoPlayerService(onSnapshot, vi.fn(), vi.fn());

    const ready = service.load(track);
    element.error = { code: 4, message: 'MEDIA_ELEMENT_ERROR: Format not supported.' } as MediaError;
    element.emit('error');

    await expect(ready).rejects.toThrow('Chromium could not decode this video.');
    expect(onSnapshot).toHaveBeenLastCalledWith({
      state: 'error',
      error: 'Chromium could not decode this video.'
    });
  });

  it('forces full native volume and routes transition gain through the audio bus when adoption succeeds', async () => {
    const sourceNode = {} as MediaElementAudioSourceNode;
    audioBus.connectHtmlMediaElement.mockReturnValue(sourceNode);
    const onSnapshot = vi.fn();
    const service = new VideoPlayerService(onSnapshot, vi.fn(), vi.fn());
    service.setFallbackVolume(0.4);

    const ready = service.load(track);
    element.emit('loadedmetadata');
    await ready;

    // Web Audio owns output gain, so the element itself stays at 1.
    expect(element.volume).toBe(1);

    service.setTransitionGain(0.5, 2);

    expect(audioBus.setSourceGain).toHaveBeenCalledWith(sourceNode, 0.5, 2);
    expect(element.volume).toBe(1);
  });
});
