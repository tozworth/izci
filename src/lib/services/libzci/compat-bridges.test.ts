import { describe, expect, it } from 'vitest';
import { CONSUMER_CONTRACT, PLAYBACK_GAPS, RAF_BRIDGE, VIDEO_BRIDGE } from './compat-bridges';

describe('A2 compatibility bridges', () => {
  it('keeps video on the native element path outside core video scope', () => {
    expect(VIDEO_BRIDGE.kind).toBe('native-video-element');
    expect(VIDEO_BRIDGE.service).toBe('VideoPlayerService');
    expect(VIDEO_BRIDGE.coreVideoScope).toBe('deferred-m5');
  });

  it('keeps Raf shell-side with an explicit video bypass', () => {
    expect(RAF_BRIDGE.kind).toBe('shell-raf-graph');
    expect(RAF_BRIDGE.coreScope).toBe('deferred-m4');
    expect(RAF_BRIDGE.bypass).toContain('auto-amp');
  });

  it('pins the known playback gaps as an explicit list', () => {
    expect(PLAYBACK_GAPS.length).toBeGreaterThan(0);
    for (const gap of PLAYBACK_GAPS) {
      expect(gap.service.length).toBeGreaterThan(0);
      expect(gap.log.length).toBeGreaterThan(0);
    }
  });

  it('pins the mobile/Oda/window consumer contract', () => {
    expect(CONSUMER_CONTRACT.mediaElements).toBe('mediaElementsStore.video');
    expect(CONSUMER_CONTRACT.snapshot).toBe('playbackSnapshot');
  });
});
