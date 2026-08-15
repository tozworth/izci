import { describe, expect, it, vi } from 'vitest';

import {
  FILE_INPUT_ACCEPT,
  OPEN_FILE_PICKER_OPTIONS,
  createImportController,
  supportsDirectoryPicker,
  supportsOpenFilePicker
} from './import-controller';
import {
  MODULE_EXTENSIONS,
  STREAM_EXTENSIONS,
  VIDEO_EXTENSIONS,
  type WorkspaceCollection
} from '$lib/types';

type PickerWindow = Window & typeof globalThis;

function fileHandle(file: File): FileSystemFileHandle {
  return {
    kind: 'file',
    name: file.name,
    getFile: async () => file
  } as FileSystemFileHandle;
}

function pickerWindow(value: object): PickerWindow {
  return value as unknown as PickerWindow;
}

describe('import controller', () => {
  it('keeps picker accept lists aligned with supported extensions', () => {
    expect(FILE_INPUT_ACCEPT.split(',')).toEqual(
      [...STREAM_EXTENSIONS, ...MODULE_EXTENSIONS, ...VIDEO_EXTENSIONS].map((extension) => `.${extension}`)
    );
    expect(OPEN_FILE_PICKER_OPTIONS.multiple).toBe(true);
    expect(OPEN_FILE_PICKER_OPTIONS.types?.[0].accept).toMatchObject({
      'audio/flac': ['.flac'],
      'audio/ogg': ['.ogg', '.opus'],
      'audio/x-openmpt': MODULE_EXTENSIONS.map((extension) => `.${extension}`),
      'video/mp4': ['.mp4', '.m4v'],
      'video/x-matroska': ['.mkv']
    });
  });

  it('detects picker support from the provided window-like object', () => {
    expect(supportsOpenFilePicker(pickerWindow({ showOpenFilePicker: async () => [] }))).toBe(true);
    expect(supportsOpenFilePicker(null)).toBe(false);
    expect(supportsDirectoryPicker(pickerWindow({ showDirectoryPicker: async () => ({}) }))).toBe(true);
    expect(supportsDirectoryPicker(null)).toBe(false);
  });

  it('falls back to the file input and preserves the pending target', async () => {
    const addFiles = vi.fn();
    const clickFileInput = vi.fn();
    const controller = createImportController({
      addFiles,
      clickFileInput,
      getWindow: () => null
    });

    await controller.openFiles('library');

    expect(clickFileInput).toHaveBeenCalledOnce();
    expect(controller.getPendingFileInputTarget()).toBe('library');

    const input = {
      files: [new File(['audio'], 'Track.flac')],
      value: 'C:\\fakepath\\Track.flac'
    };

    await controller.handleFileInputChange({ currentTarget: input } as unknown as Event);

    expect(addFiles).toHaveBeenCalledWith(input.files, 'library');
    expect(input.value).toBe('');
  });

  it('imports selected files from the File System Access picker', async () => {
    const pickedFile = new File(['audio'], 'Picked.opus');
    const addFiles = vi.fn((_: FileList | File[], __: WorkspaceCollection) => {});
    const showOpenFilePicker = vi.fn(async () => [fileHandle(pickedFile)]);

    const controller = createImportController({
      addFiles,
      clickFileInput: vi.fn(),
      getWindow: () =>
        pickerWindow({
          showOpenFilePicker
        })
    });

    await controller.openFiles('queue');

    expect(showOpenFilePicker).toHaveBeenCalledWith(OPEN_FILE_PICKER_OPTIONS);
    expect(addFiles).toHaveBeenCalledWith([pickedFile], 'queue');
  });

  it('ignores picker cancellation without triggering imports', async () => {
    const addFiles = vi.fn();
    const controller = createImportController({
      addFiles,
      clickFileInput: vi.fn(),
      getWindow: () =>
        pickerWindow({
          showOpenFilePicker: async () => {
            throw new DOMException('Cancelled', 'AbortError');
          }
        })
    });

    await controller.openFiles('queue');

    expect(addFiles).not.toHaveBeenCalled();
  });
});
