import { describe, expect, it, vi } from 'vitest';
import type { MediaEntity } from '$lib/contracts/catalog';
import { mediaSources } from '$lib/media/media-source';
import { materializeMediaEntity } from './playlist-materialization';

function moduleItem(handle: FileSystemFileHandle): MediaEntity {
  return {
    id: 'remembered-module',
    name: 'remembered.xm',
    format: 'xm',
    kind: 'module',
    size: 1,
    lastModified: 1,
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
    mediaSources.registerHandle(remembered.id, handle, 'granted');

    await expect(materializeMediaEntity(remembered)).resolves.toMatchObject({
      entity: { id: 'remembered-module' },
      file: expect.any(File),
    });

    permission = 'denied';
    await expect(materializeMediaEntity(remembered)).resolves.toBeNull();
    expect(getFile).toHaveBeenCalledOnce();
    expect(requestPermission).not.toHaveBeenCalled();

    await expect(materializeMediaEntity(remembered, true)).resolves.toBeNull();
    expect(requestPermission).toHaveBeenCalledOnce();
    expect(getFile).toHaveBeenCalledOnce();
  });
});
