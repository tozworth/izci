import { afterEach, describe, expect, it, vi } from 'vitest';
import { withMediaFileReader } from './media-file-reader';
import { ANDROID_FILE_SNAPSHOT_MAX_BYTES } from '../../platform/web-file-read-policy';

afterEach(() => vi.unstubAllGlobals());
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
};

describe('bounded mobile metadata snapshots', () => {
  it('shares fresh wrappers during concurrent reads and releases after the jobs', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Android' });
    const first = new File(['metadata'], 'track.opus', { lastModified: 1 });
    const second = new File([first], first.name, { lastModified: 1 });
    const a = vi.spyOn(first, 'arrayBuffer');
    const b = vi.spyOn(second, 'arrayBuffer');
    const gate = deferred();
    const job = async (read: (offset: number, length: number) => Promise<Uint8Array>) => {
      const result = await read(0, 4);
      await gate.promise;
      return new TextDecoder().decode(result);
    };
    const one = withMediaFileReader(first, 'same-track', job);
    const two = withMediaFileReader(second, 'same-track', job);
    gate.resolve();
    expect(await Promise.all([one, two])).toEqual(['meta', 'meta']);
    expect(a).toHaveBeenCalledOnce();
    expect(b).not.toHaveBeenCalled();
    await withMediaFileReader(second, 'same-track', (read) => read(0, 4));
    expect(b).toHaveBeenCalledOnce();
  });

  it('reserves pending snapshots against the byte budget and uses ranges when full', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Android' });
    const gate = deferred();
    const files = Array.from({ length: 3 }, (_, i) => {
      const file = new File(['abcd'], `${i}.opus`);
      Object.defineProperty(file, 'size', { value: ANDROID_FILE_SNAPSHOT_MAX_BYTES });
      return file;
    });
    const pending = files.slice(0, 2).map((file, i) => {
      vi.spyOn(file, 'arrayBuffer').mockImplementation(async () => {
        await gate.promise;
        return new TextEncoder().encode('abcd').buffer;
      });
      return withMediaFileReader(file, `pending-${i}`, (read) => read(0, 4));
    });
    const fullRead = vi.spyOn(files[2], 'arrayBuffer');
    const rangedRead = vi.spyOn(files[2], 'slice');
    await withMediaFileReader(files[2], 'fallback', (read) => read(0, 4));
    expect(fullRead).not.toHaveBeenCalled();
    expect(rangedRead).toHaveBeenCalledWith(0, 4);
    gate.resolve();
    await Promise.all(pending);
    await withMediaFileReader(files[2], 'after-release', (read) => read(0, 4));
    expect(fullRead).toHaveBeenCalledOnce();
  });

  it('releases failed reads and does not reuse a changed file version', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Android' });
    const file = new File(['abcd'], 'track.opus', { lastModified: 1 });
    const fullRead = vi.spyOn(file, 'arrayBuffer').mockRejectedValueOnce(new Error('read failed'));
    await expect(withMediaFileReader(file, 'failed', (read) => read(0, 4))).rejects.toThrow('read failed');
    await expect(withMediaFileReader(file, 'failed', (read) => read(0, 4))).resolves.toHaveLength(4);
    expect(fullRead).toHaveBeenCalledTimes(2);
    const gate = deferred();
    const pending = withMediaFileReader(file, 'changing', async (read) => { await read(0, 4); await gate.promise; });
    const changed = new File(['next'], file.name, { lastModified: 2 });
    expect(new TextDecoder().decode(await withMediaFileReader(changed, 'changing', (read) => read(0, 4)))).toBe('next');
    gate.resolve();
    await pending;
  });

  it('uses ranges for desktop and oversized Android files', async () => {
    const file = new File(['abcd'], 'large.flac');
    const fullRead = vi.spyOn(file, 'arrayBuffer');
    const slices = vi.spyOn(file, 'slice');
    vi.stubGlobal('navigator', { userAgent: 'Windows NT' });
    await withMediaFileReader(file, 'desktop', (read) => read(1, 2));
    vi.stubGlobal('navigator', { userAgent: 'Android' });
    Object.defineProperty(file, 'size', { value: ANDROID_FILE_SNAPSHOT_MAX_BYTES + 1 });
    await withMediaFileReader(file, 'oversized', (read) => read(1, 2));
    expect(fullRead).not.toHaveBeenCalled();
    expect(slices).toHaveBeenCalledTimes(2);
    expect(slices).toHaveBeenLastCalledWith(1, 3);
  });
});
