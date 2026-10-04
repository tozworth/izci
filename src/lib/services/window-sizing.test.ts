import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WindowGeometry } from './window-geometry';

const platform = vi.hoisted(() => ({ readWindowGeometry: vi.fn(), applyWindowBounds: vi.fn() }));
vi.mock('$platform', () => platform);

import { createTemporaryWindowSizer } from './window-sizing';
import { ensureComfortableNowPlayingWindowSize, restoreNowPlayingWindowSize } from './window-now-playing';
import { ensureComfortableVideoWindowSize, restoreVideoWindowSize } from './window-video';

const geometry: WindowGeometry = {
  innerWidth: 500, innerHeight: 300, outerWidth: 516, outerHeight: 338,
  screenX: 100, screenY: 50,
  screen: { availWidth: 1920, availHeight: 1040, availLeft: 0, availTop: 0 }
};
const original = { left: 100, top: 50, width: 516, height: 338 };
const target = { left: 100, top: 50, width: 1280, height: 800 };

describe('temporary player window sizing', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    platform.readWindowGeometry.mockResolvedValue(geometry);
    platform.applyWindowBounds.mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('grows and restores both Now Playing and video through the platform adapter', async () => {
    await ensureComfortableNowPlayingWindowSize();
    await restoreNowPlayingWindowSize();
    await ensureComfortableVideoWindowSize();
    await restoreVideoWindowSize();
    expect(platform.applyWindowBounds.mock.calls.map(([bounds]) => bounds)).toEqual([
      target, original, { ...target, height: 720 }, original
    ]);
  });

  it('retains the original bounds across repeated growth', async () => {
    const sizer = createTemporaryWindowSizer(() => target);
    await sizer.ensure();
    platform.readWindowGeometry.mockResolvedValue({ ...geometry, outerWidth: 1000, outerHeight: 700 });
    await sizer.ensure();
    await sizer.restore();
    expect(platform.applyWindowBounds).toHaveBeenLastCalledWith(original);
  });

  it('cancels growth if the view closes during the native geometry read', async () => {
    let finishRead!: (value: WindowGeometry) => void;
    platform.readWindowGeometry.mockImplementationOnce(() => new Promise((resolve) => { finishRead = resolve; }));
    const sizer = createTemporaryWindowSizer(() => target);
    const entering = sizer.ensure();
    await vi.waitFor(() => expect(platform.readWindowGeometry).toHaveBeenCalled());
    const exiting = sizer.restore();
    finishRead(geometry);
    await Promise.all([entering, exiting]);
    expect(platform.applyWindowBounds).not.toHaveBeenCalled();
  });

  it('waits for an in-flight resize before restoring', async () => {
    let finishResize!: () => void;
    platform.applyWindowBounds.mockImplementationOnce(() => new Promise<void>((resolve) => { finishResize = resolve; }));
    const sizer = createTemporaryWindowSizer(() => target);
    const entering = sizer.ensure();
    await vi.waitFor(() => expect(platform.applyWindowBounds).toHaveBeenCalledWith(target));
    const exiting = sizer.restore();
    expect(platform.applyWindowBounds).toHaveBeenCalledTimes(1);
    finishResize();
    await Promise.all([entering, exiting]);
    expect(platform.applyWindowBounds).toHaveBeenLastCalledWith(original);
  });

  it('reports a failed native resize and allows subsequent restoration', async () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => {});
    platform.applyWindowBounds.mockRejectedValueOnce(new Error('IPC denied'));
    const sizer = createTemporaryWindowSizer(() => target);
    await sizer.ensure();
    await sizer.restore();
    expect(report).toHaveBeenCalledOnce();
    expect(platform.applyWindowBounds).toHaveBeenLastCalledWith(original);
  });
});
