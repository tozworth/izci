import { describe, expect, it, vi } from 'vitest';
import type { TrackItem } from '$lib/types';
import { materializeTrackItem } from './queue-materialization';

function moduleItem(handle: FileSystemFileHandle): TrackItem {
  return {
    id: 'remembered-module',
    name: 'remembered.xm',
    extension: 'xm',
    kind: 'module',
    size: 1,
    lastModified: 1,
    fileHandle: handle,
    path: 'Music/remembered.xm'
  };
}

describe('playlist materialization permission characterization', () => {
  it('stops reading a remembered handle after its permission is lost', async () => {
    let permission: FileSystemPermissionState = 'granted';
    const getFile = vi.fn(async () => new File(['module'], 'remembered.xm', { lastModified: 2 }));
    const requestPermission = vi.fn(async () => 'denied' as const);
    const handle = {
      kind: 'file',
      name: 'remembered.xm',
      queryPermission: vi.fn(async () => permission),
      requestPermission,
      getFile
    } as unknown as FileSystemFileHandle;
    const remembered = moduleItem(handle);

    await expect(materializeTrackItem(remembered)).resolves.toMatchObject({
      id: 'remembered-module',
      file: expect.any(File),
      lastModified: 2
    });

    permission = 'denied';
    await expect(materializeTrackItem(remembered)).resolves.toBeNull();
    expect(getFile).toHaveBeenCalledOnce();
    expect(requestPermission).not.toHaveBeenCalled();

    await expect(materializeTrackItem(remembered, true)).resolves.toBeNull();
    expect(requestPermission).toHaveBeenCalledOnce();
    expect(getFile).toHaveBeenCalledOnce();
  });
});
