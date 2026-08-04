import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaylistItem } from '$lib/types';

interface MockHowlOptions {
  onload: () => void;
}

interface MockHowlInstance {
  options: MockHowlOptions;
  stateValue: 'loading' | 'loaded' | 'unloaded';
  playingValue: boolean;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
}

const howlerHarness = vi.hoisted(() => ({
  instances: [] as MockHowlInstance[]
}));

const audioBus = vi.hoisted(() => ({
  disconnect: vi.fn(),
  resume: vi.fn(async () => true),
  setSourceGain: vi.fn()
}));

vi.mock('howler', () => ({
  Howl: class {
    options: MockHowlOptions;
    stateValue: 'loading' | 'loaded' | 'unloaded' = 'loading';
    playingValue = false;
    _sounds: unknown[] = [];

    play = vi.fn(() => {
      this.playingValue = true;
      return 1;
    });

    pause = vi.fn(() => {
      this.playingValue = false;
    });

    stop = vi.fn(() => {
      this.playingValue = false;
    });

    unload = vi.fn(() => {
      this.stateValue = 'unloaded';
      this.playingValue = false;
    });

    rate = vi.fn();
    seek = vi.fn(() => 0);
    duration = vi.fn(() => 180);
    volume = vi.fn(() => 1);
    playing = vi.fn(() => this.playingValue);
    state = vi.fn(() => this.stateValue);

    constructor(options: MockHowlOptions) {
      this.options = options;
      howlerHarness.instances.push(this);
    }
  }
}));

vi.mock('$lib/services/audio-bus', () => ({ audioBusService: audioBus }));

import { HowlerPlayerService } from './howler-player';

const track: PlaylistItem = {
  id: 'track-1',
  name: 'Transferred track',
  extension: 'opus',
  kind: 'stream',
  size: 1_024,
  lastModified: 1,
  objectUrl: 'blob:test-track'
};

describe('HowlerPlayerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    howlerHarness.instances.length = 0;
  });

  it('coalesces repeated play requests while loading and playing', async () => {
    const service = new HowlerPlayerService(vi.fn(), vi.fn(), vi.fn());
    const ready = service.load(track);
    const howl = howlerHarness.instances[0];

    service.play();
    service.play();
    service.play();
    expect(howl.play).not.toHaveBeenCalled();

    howl.stateValue = 'loaded';
    howl.options.onload();
    await ready;
    expect(howl.play).toHaveBeenCalledTimes(1);

    service.play();
    service.play();
    expect(howl.play).toHaveBeenCalledTimes(1);
  });

  it('allows playback to resume after a pause', async () => {
    const service = new HowlerPlayerService(vi.fn(), vi.fn(), vi.fn());
    const ready = service.load(track, { autoPlay: true });
    const howl = howlerHarness.instances[0];

    howl.stateValue = 'loaded';
    howl.options.onload();
    await ready;
    service.pause();
    service.play();

    expect(howl.pause).toHaveBeenCalledTimes(1);
    expect(howl.play).toHaveBeenCalledTimes(2);
  });
});
