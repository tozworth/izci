import { describe, expect, it, vi } from 'vitest';

import { buildPlaylistItems } from '$lib/utils/files';
import { prepareImportedFiles } from './file-verification';

describe('added-file verification', () => {
  it('keeps known formats without probing them', async () => {
    const verifyModuleFile = vi.fn(async () => false);
    const file = new File(['module'], 'Known.med');

    await expect(
      prepareImportedFiles([file], { verifyUnknownFiles: true, verifyModuleFile })
    ).resolves.toEqual([file]);
    expect(verifyModuleFile).not.toHaveBeenCalled();
  });

  it('only admits unknown extensions when OpenMPT verification succeeds', async () => {
    const accepted = new File(['module'], 'Accepted.custom');
    const rejected = new File(['text'], 'Rejected.bin');
    const verifyModuleFile = vi.fn(async (file: File) => file === accepted);

    const files = await prepareImportedFiles([accepted, rejected], {
      verifyUnknownFiles: true,
      verifyModuleFile
    });
    const items = buildPlaylistItems(files);

    expect(files).toEqual([accepted]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: 'Accepted.custom', extension: 'custom', kind: 'module' });
  });

  it('adds unknown extensions as modules without probing when verification is disabled', async () => {
    const verifyModuleFile = vi.fn(async () => false);
    const file = new File(['anything'], 'Unknown.dat');

    const files = await prepareImportedFiles([file], {
      verifyUnknownFiles: false,
      verifyModuleFile
    });

    expect(files).toEqual([file]);
    expect(verifyModuleFile).not.toHaveBeenCalled();
    expect(buildPlaylistItems(files)[0]).toMatchObject({
      name: 'Unknown.dat',
      extension: 'dat',
      kind: 'module'
    });
  });
});
