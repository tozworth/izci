import type { WorkspaceCollection } from '$lib/types';
import { readDirectorySurfaceFiles, readFileHandleFiles } from '$lib/utils/files';

type PickerWindow = Window &
  typeof globalThis & {
    showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
    showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>;
  };

interface ImportControllerOptions {
  addFiles: (files: FileList | File[], target: WorkspaceCollection) => void;
  clickFileInput: () => void;
  getWindow?: () => PickerWindow | null;
}

export const FILE_INPUT_ACCEPT =
  '.mp3,.wav,.flac,.ogg,.opus,.mod,.xm,.s3m,.it';

export const OPEN_FILE_PICKER_OPTIONS: OpenFilePickerOptions = {
  multiple: true,
  types: [
    {
      description: 'Supported audio files',
      accept: {
        'audio/mpeg': ['.mp3'],
        'audio/wav': ['.wav'],
        'audio/flac': ['.flac'],
        'audio/ogg': ['.ogg', '.opus'],
        'audio/opus': ['.opus'],
        'audio/x-mod': ['.mod'],
        'audio/x-xm': ['.xm'],
        'audio/x-s3m': ['.s3m'],
        'audio/x-it': ['.it']
      }
    }
  ]
};

function getDefaultWindow(): PickerWindow | null {
  return typeof window === 'undefined' ? null : (window as PickerWindow);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function supportsOpenFilePicker(targetWindow = getDefaultWindow()): boolean {
  return Boolean(targetWindow?.showOpenFilePicker);
}

export function supportsDirectoryPicker(targetWindow = getDefaultWindow()): boolean {
  return Boolean(targetWindow?.showDirectoryPicker);
}

export function createImportController(options: ImportControllerOptions) {
  const getWindow = options.getWindow ?? getDefaultWindow;
  let pendingFileInputTarget: WorkspaceCollection = 'playlist';

  return {
    getPendingFileInputTarget(): WorkspaceCollection {
      return pendingFileInputTarget;
    },
    supportsOpenFilePicker(): boolean {
      return supportsOpenFilePicker(getWindow());
    },
    supportsDirectoryPicker(): boolean {
      return supportsDirectoryPicker(getWindow());
    },
    async openFiles(target: WorkspaceCollection): Promise<void> {
      const pickerWindow = getWindow();

      if (!pickerWindow || !supportsOpenFilePicker(pickerWindow)) {
        pendingFileInputTarget = target;
        options.clickFileInput();
        return;
      }

      try {
        const handles = await pickerWindow.showOpenFilePicker?.(OPEN_FILE_PICKER_OPTIONS);
        const files = handles ? await readFileHandleFiles(handles) : [];

        if (files.length > 0) {
          options.addFiles(files, target);
        }
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }

        throw error;
      }
    },
    async openFolder(target: WorkspaceCollection): Promise<void> {
      const pickerWindow = getWindow();

      if (!pickerWindow || !supportsDirectoryPicker(pickerWindow)) {
        return;
      }

      try {
        const directoryHandle = await pickerWindow.showDirectoryPicker?.();
        const files = directoryHandle ? await readDirectorySurfaceFiles(directoryHandle) : [];

        if (files.length > 0) {
          options.addFiles(files, target);
        }
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }

        throw error;
      }
    },
    handleFileInputChange(event: Event): void {
      const input = event.currentTarget as HTMLInputElement;

      if (!input.files?.length) {
        return;
      }

      options.addFiles(input.files, pendingFileInputTarget);
      input.value = '';
    }
  };
}
