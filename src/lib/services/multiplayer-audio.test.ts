import { beforeEach, describe, expect, it, vi } from 'vitest';

const audioBus = vi.hoisted(() => ({
  connectMediaStream: vi.fn(),
  connectMediaStreamAfterRaf: vi.fn(),
  disconnect: vi.fn(),
  resume: vi.fn(async () => true),
  getBroadcastTrack: vi.fn(),
  setBroadcastGain: vi.fn(),
  releaseBroadcastTrack: vi.fn()
}));

vi.mock('$lib/services/audio-bus', () => ({ audioBusService: audioBus }));

import { MultiplayerAudioService } from './multiplayer-audio';

class FakeAudioElement {
  autoplay = false;
  muted = false;
  preload = '';
  srcObject: MediaStream | null = null;
  style: Record<string, string> = {};
  play = vi.fn(async () => undefined);
  pause = vi.fn();
  load = vi.fn();
  remove = vi.fn();
  setAttribute = vi.fn();
  removeAttribute = vi.fn();
}

describe('MultiplayerAudioService', () => {
  let element: FakeAudioElement;
  let service: MultiplayerAudioService;
  const stream = { getAudioTracks: () => [track] } as unknown as MediaStream;
  const track = {
    muted: false,
    readyState: 'live',
    onmute: null,
    onunmute: null,
    onended: null
  } as unknown as MediaStreamTrack;

  beforeEach(() => {
    vi.clearAllMocks();
    element = new FakeAudioElement();
    vi.stubGlobal('Audio', class {
      constructor() {
        return element;
      }
    });
    vi.stubGlobal('document', { body: { appendChild: vi.fn() } });
    audioBus.connectMediaStream.mockReturnValue({});
    audioBus.connectMediaStreamAfterRaf.mockReturnValue({});
    service = new MultiplayerAudioService();
  });

  it('feeds pre-Raf WebRTC audio directly into the local Raf graph', async () => {
    const statuses: string[] = [];

    await service.attachRemoteTrack(track, stream, (status) => statuses.push(status));

    expect(audioBus.connectMediaStream).toHaveBeenCalledWith(stream);
    expect(audioBus.connectMediaStreamAfterRaf).not.toHaveBeenCalled();
    expect(element.muted).toBe(true);
    expect(element.srcObject).toBe(stream);
    expect(statuses.at(-1)).toBe('playing');
  });

  it('keeps the listener in control of local Raf routing', async () => {
    await service.attachRemoteTrack(track, stream, () => undefined);

    expect(audioBus.connectMediaStream).toHaveBeenCalledWith(stream);
    expect(audioBus.connectMediaStreamAfterRaf).not.toHaveBeenCalled();
  });

  it('does not tear down a live pipeline when the same track is re-attached', async () => {
    const statuses: string[] = [];
    const handler = (status: string) => statuses.push(status);
    await service.attachRemoteTrack(track, stream, handler);

    // A redundant audio message (e.g. a host progress publish) re-attaches the
    // same receiver track. It must not clear the element and rebuild: that is
    // what made streamed Freeplay stutter and flap between "Audio connecting"
    // and "Listening".
    await service.attachRemoteTrack(track, stream, handler);

    expect(audioBus.disconnect).toHaveBeenCalledTimes(0); // nothing connected yet
    expect(element.remove).toHaveBeenCalledTimes(0);
    expect(audioBus.connectMediaStream).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual(['connecting', 'playing', 'playing']);
  });

  it('rebuilds the pipeline when a different track is attached', async () => {
    const otherTrack = {
      muted: false,
      readyState: 'live',
      onmute: null,
      onunmute: null,
      onended: null
    } as unknown as MediaStreamTrack;
    await service.attachRemoteTrack(track, stream, () => undefined);
    await service.attachRemoteTrack(otherTrack, stream, () => undefined);

    expect(element.remove).toHaveBeenCalledTimes(1);
    expect(audioBus.connectMediaStream).toHaveBeenCalledTimes(2);
  });

  it('drains the receiver without tearing the element down (source-file interlude sink)', async () => {
    await service.attachRemoteTrack(track, stream, () => undefined);
    audioBus.disconnect.mockClear();
    element.remove.mockClear();
    element.pause.mockClear();

    // Source-file interlude: the element stays attached and playing (muted,
    // out of the graph) so the receiver's jitter buffer keeps advancing —
    // a frozen buffer would replay the previous streamed track's tail.
    service.drainRemoteTrack();

    expect(audioBus.disconnect).toHaveBeenCalledTimes(1);
    expect(element.remove).toHaveBeenCalledTimes(0);
    expect(element.pause).toHaveBeenCalledTimes(0);
    expect(element.play).toHaveBeenCalled();
  });

  it('throws the stream away on a source-file interlude and rebuilds fresh on re-attach', async () => {
    await service.attachRemoteTrack(track, stream, () => undefined);
    audioBus.disconnect.mockClear();
    element.remove.mockClear();
    element.pause.mockClear();

    // A streamed track must build a FRESH pipeline after an interlude: tear
    // the drained element down, then attach (new element, new route). The
    // receiver buffer was flushed during the interlude, so the fresh element
    // starts from silence, never from retained old audio.
    service.clearRemoteTrack();

    expect(audioBus.disconnect).toHaveBeenCalledTimes(1);
    expect(element.remove).toHaveBeenCalledTimes(1);
    expect(element.pause).toHaveBeenCalledTimes(1);

    await service.attachRemoteTrack(track, stream, () => undefined);
    expect(audioBus.connectMediaStream).toHaveBeenCalledTimes(2);
    expect(element.remove).toHaveBeenCalledTimes(1); // only the original teardown
  });

  it('is a no-op when nothing is attached', () => {
    service.clearRemoteTrack();
    expect(audioBus.disconnect).not.toHaveBeenCalled();
  });
});
