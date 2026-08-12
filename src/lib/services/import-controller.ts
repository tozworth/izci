import { type WorkspaceCollection } from '$lib/contracts/workspace';
import {
  createMediaOpenFilePickerOptions,
  mediaFileInputAccept
} from '$lib/media/format-policy';
import { prepareImportedFiles } from '$lib/services/file-verification';
import { filesystemFolders } from '$lib/services/filesystem-folders';
import { logError, logInfo } from '$lib/logging/api';
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
  getOpenFilePickerDescription?: () => string;
}

export const FILE_INPUT_ACCEPT = mediaFileInputAccept();

export function createOpenFilePickerOptions(description = 'Supported media files'): OpenFilePickerOptions {
  return createMediaOpenFilePickerOptions({ description, multiple: true });
}

export const OPEN_FILE_PICKER_OPTIONS = createOpenFilePickerOptions();

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
  const getOpenFilePickerDescription =
    options.getOpenFilePickerDescription ?? (() => OPEN_FILE_PICKER_OPTIONS.types?.[0].description ?? '');
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
        const handles = await pickerWindow.showOpenFilePicker?.(
          createOpenFilePickerOptions(getOpenFilePickerDescription())
        );
        const pickedFiles = handles ? await readFileHandleFiles(handles) : [];
        const files = await prepareImportedFiles(pickedFiles);
        logInfo('files', 'File import completed', { target, selected: pickedFiles.length, accepted: files.length });

        if (files.length > 0) {
          options.addFiles(files, target);
        }
      } catch (error) {
        if (isAbortError(error)) {
          logInfo('files', 'File picker cancelled', { target });
          return;
        }

        logError('files', 'File import failed', { target, error });
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
        logInfo('files', 'Folder import completed', { target, folder: directoryHandle?.name, discovered: discoveredFiles.length, accepted: files.length });

        if (files.length > 0) {
          options.addFiles(files, target);
        }
      } catch (error) {
        if (isAbortError(error)) {
          logInfo('files', 'Folder picker cancelled', { target });
          return;
        }

        logError('files', 'Folder import failed', { target, error });
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
      logInfo('files', 'Fallback file-input import completed', { target: pendingFileInputTarget, selected: selectedFiles.length, accepted: files.length });

      if (files.length > 0) {
        options.addFiles(files, pendingFileInputTarget);
      }
    }
  };
}
