import { MODULE_EXTENSIONS, STREAM_EXTENSIONS, type WorkspaceCollection } from '$lib/types';
import { prepareImportedFiles } from '$lib/services/file-verification';
import { filesystemFolders } from '$lib/services/filesystem-folders';
import { trackSettings } from '$lib/stores/track-settings';
import { readDirectoryFiles, readFileHandleFiles } from '$lib/utils/files';

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

const STREAM_FILE_EXTENSIONS = STREAM_EXTENSIONS.map((extension) => `.${extension}`);
const MODULE_FILE_EXTENSIONS = MODULE_EXTENSIONS.map((extension) => `.${extension}`);

export const FILE_INPUT_ACCEPT = [...STREAM_FILE_EXTENSIONS, ...MODULE_FILE_EXTENSIONS].join(',');

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
        'audio/x-openmpt': MODULE_FILE_EXTENSIONS
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
        const pickedFiles = handles ? await readFileHandleFiles(handles) : [];
        const files = await prepareImportedFiles(pickedFiles);

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
        if (directoryHandle) {
          await filesystemFolders.remember(directoryHandle);
        }
        const discoveredFiles = directoryHandle
          ? await readDirectoryFiles(directoryHandle, {
              maxDepth: trackSettings.getSnapshot().folderNestingLimit
            })
          : [];
        const files = await prepareImportedFiles(discoveredFiles);

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
    async handleFileInputChange(event: Event): Promise<void> {
      const input = event.currentTarget as HTMLInputElement;

      if (!input.files?.length) {
        return;
      }

      const selectedFiles = Array.from(input.files);
      input.value = '';
      const files = await prepareImportedFiles(selectedFiles);

      if (files.length > 0) {
        options.addFiles(files, pendingFileInputTarget);
      }
    }
  };
}
