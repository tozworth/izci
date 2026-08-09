import { beforeEach, describe, expect, it, vi } from 'vitest';

const audioBus = vi.hoisted(() => ({
  connectMediaStream: vi.fn(),
  connectMediaStreamAfterRaf: vi.fn(),
  disconnect: vi.fn(),
  setSourceGain: vi.fn(),
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
    expect(audioBus.setSourceGain).toHaveBeenCalledWith({}, 0);
    expect(statuses.at(-1)).toBe('ready');
  });

  it('keeps one element and Web Audio source across delivery generations', async () => {
    await service.attachRemoteTrack(track, stream, () => undefined);
    await service.attachRemoteTrack(track, stream, () => undefined);
    service.setRemoteAudible(true);

    expect(audioBus.connectMediaStream).toHaveBeenCalledTimes(1);
    expect(element.pause).not.toHaveBeenCalled();
    expect(audioBus.setSourceGain).toHaveBeenLastCalledWith({}, 1, 0.04);
  });

  it('keeps the listener in control of local Raf routing', async () => {
    await service.attachRemoteTrack(track, stream, () => undefined);

    expect(audioBus.connectMediaStream).toHaveBeenCalledWith(stream);
    expect(audioBus.connectMediaStreamAfterRaf).not.toHaveBeenCalled();
  });

  it('does not declare a suspended receiver pipeline ready', async () => {
    const statuses: string[] = [];
    audioBus.resume.mockResolvedValueOnce(false);

    await expect(service.attachRemoteTrack(track, stream, (status) => statuses.push(status)))
      .resolves.toBe(false);
    expect(statuses.at(-1)).toBe('blocked');
  });

  it('ignores a resume completion after the receiver route was cleared', async () => {
    const deferred: { finish?: (running: boolean) => void } = {};
    audioBus.resume.mockImplementationOnce(() => new Promise<boolean>((resolve) => {
      deferred.finish = resolve;
    }));

    const attaching = service.attachRemoteTrack(track, stream, () => undefined);
    service.clearRemoteTrack();
    deferred.finish?.(true);

    await expect(attaching).resolves.toBe(false);
  });
});
