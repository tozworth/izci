import { afterEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ referenceScheme: 'content:', pickFiles: vi.fn(), pickFolder: vi.fn(), readFolder: vi.fn() }));
const remember = vi.hoisted(() => vi.fn());
vi.mock('$platform', async () => {
  const { createNativeFilesystem } = await import('../platform/native-filesystem');
  return { filesystem: createNativeFilesystem(native as never, { accessModel: 'persisted-grants' }) };
});
vi.mock('$lib/services/filesystem-folders', () => ({ filesystemFolders: { remember } }));
vi.mock('$lib/services/file-verification', () => ({ prepareImportedFiles: async (files: File[]) => files }));
vi.mock('$lib/services/logging', () => ({ logInfo: vi.fn(), logError: vi.fn() }));
import { createImportController } from '$lib/services/import-controller';
afterEach(() => vi.clearAllMocks());

describe('native SAF import dispatch', () => {
  it('uses the native multi-file picker and preserves the collection target without a browser file input', async () => {
    const files = [new File(['data'], 'song.flac')];
    native.pickFiles.mockResolvedValue(files);
    const addFiles = vi.fn(); const clickFileInput = vi.fn();
    const controller = createImportController({ addFiles, clickFileInput, getWindow: () => null });
    expect(controller.supportsOpenFilePicker()).toBe(true);
    expect(controller.supportsDirectoryPicker()).toBe(true);
    await controller.openFiles('library');
    expect(addFiles).toHaveBeenCalledWith(files, 'library');
    expect(clickFileInput).not.toHaveBeenCalled();
  });
  it('remembers the selected tree and uses the shared nesting limit before adding its files', async () => {
    const root = { uri: 'content://provider/tree/Music', name: 'Music' };
    const files = [new File(['data'], 'song.xm')];
    native.pickFolder.mockResolvedValue(root);
    remember.mockResolvedValue({ id: 'root', nativeFolder: root });
    native.readFolder.mockResolvedValue(files);
    const addFiles = vi.fn();
    await createImportController({ addFiles, clickFileInput: vi.fn(), getWindow: () => null }).openFolder('queue');
    expect(remember).toHaveBeenCalledWith({ name: root.name, nativeFolder: root });
    expect(native.readFolder).toHaveBeenCalledWith(root, 8);
    expect(addFiles).toHaveBeenCalledWith(files, 'queue');
  });
  it('does not mutate collections when the SAF picker is cancelled', async () => {
    native.pickFiles.mockRejectedValue(new DOMException('Cancelled', 'AbortError'));
    native.pickFolder.mockRejectedValue(new DOMException('Cancelled', 'AbortError'));
    const addFiles = vi.fn();
    const controller = createImportController({ addFiles, clickFileInput: vi.fn(), getWindow: () => null });
    await controller.openFiles('queue'); await controller.openFolder('library');
    expect(addFiles).not.toHaveBeenCalled(); expect(remember).not.toHaveBeenCalled();
  });
});
