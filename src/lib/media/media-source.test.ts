import { describe, expect, it, vi } from 'vitest';
import type { MediaEntity } from '$lib/contracts/catalog';
import { MediaSourceRegistry, materializeMediaEntity } from './media-source';

function entity(kind: MediaEntity['kind'], format = kind === 'module' ? 'mod' : 'mp3'): MediaEntity {
  return {
    id: 'media-1',
    path: 'Music/Track.mp3',
    name: 'Track.mp3',
    format,
    kind,
    size: 1,
    lastModified: 2
  };
}

describe('media source ownership and leases', () => {
  it('keeps File and handles outside durable entities and clones locators explicitly', () => {
    const sources = new MediaSourceRegistry();
    const file = new File(['abc'], 'Track.mp3', { lastModified: 7 });
    sources.registerFile('media-1', file);
    sources.clone('media-1', 'media-2');

    expect(sources.get('media-1')).toMatchObject({ entityId: 'media-1', file });
    expect(sources.get('media-2')).toMatchObject({ entityId: 'media-2', file });
    expect(JSON.stringify(entity('stream'))).not.toMatch(/file|handle|objectUrl/i);
  });

  it('creates idempotent object-URL leases only for stream and video entities', async () => {
    const create = vi.fn(() => 'blob:track');
    const revoke = vi.fn();
    const file = new File(['abc'], 'Track.mp3', { lastModified: 7 });
    const streamLease = await materializeMediaEntity(
      entity('stream'),
      { entityId: 'media-1', file, permission: 'granted' },
      { purpose: 'media-element', objectUrls: { create, revoke } }
    );
    expect(streamLease).toMatchObject({ file, objectUrl: 'blob:track' });
    expect(streamLease?.entity).toMatchObject({ size: 3, lastModified: 7, format: 'mp3' });
    streamLease?.release();
    streamLease?.release();
    expect(revoke).toHaveBeenCalledOnce();

    const moduleFile = new File(['module'], 'Track.mod');
    const moduleLease = await materializeMediaEntity(
      entity('module'),
      { entityId: 'media-1', file: moduleFile, permission: 'granted' },
      { purpose: 'media-element', objectUrls: { create, revoke } }
    );
    expect(moduleLease?.objectUrl).toBeUndefined();
    expect(create).toHaveBeenCalledOnce();
    moduleLease?.release();
    expect(revoke).toHaveBeenCalledOnce();
  });

  it('preserves explicit permission prompting and accepts previously verified unknown modules', async () => {
    const calls: string[] = [];
    const file = new File(['module'], 'Track.unknown');
    const handle = {
      kind: 'file',
      name: file.name,
      queryPermission: async () => { calls.push('query'); return 'prompt' as const; },
      requestPermission: async () => { calls.push('request'); return 'granted' as const; },
      getFile: async () => { calls.push('get-file'); return file; }
    } as FileSystemFileHandle;
    const objectUrls = { create: vi.fn(() => 'blob:unexpected'), revoke: vi.fn() };

    await expect(materializeMediaEntity(
      { ...entity('module', 'unknown'), name: file.name },
      { entityId: 'media-1', fileHandle: handle, permission: 'prompt' },
      { prompt: false, objectUrls }
    )).resolves.toBeNull();
    expect(calls).toEqual(['query']);

    const lease = await materializeMediaEntity(
      { ...entity('module', 'unknown'), name: file.name },
      { entityId: 'media-1', fileHandle: handle, permission: 'prompt' },
      { prompt: true, objectUrls }
    );
    expect(calls).toEqual(['query', 'query', 'request', 'get-file']);
    expect(lease?.entity).toMatchObject({ kind: 'module', format: 'unknown' });
    expect(lease?.objectUrl).toBeUndefined();
    expect(objectUrls.create).not.toHaveBeenCalled();
  });

  it('rejects locator identity mismatches and unsupported refreshed stream formats', async () => {
    const objectUrls = { create: vi.fn(() => 'blob:track'), revoke: vi.fn() };
    const unknown = new File(['x'], 'Track.unknown');
    await expect(materializeMediaEntity(
      entity('stream'),
      { entityId: 'other', file: unknown, permission: 'granted' },
      { objectUrls }
    )).resolves.toBeNull();
    await expect(materializeMediaEntity(
      entity('stream'),
      { entityId: 'media-1', file: unknown, permission: 'granted' },
      { objectUrls }
    )).resolves.toBeNull();
    expect(objectUrls.create).not.toHaveBeenCalled();
  });
});
