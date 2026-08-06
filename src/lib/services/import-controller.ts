import {
  MODULE_EXTENSIONS,
  STREAM_EXTENSIONS,
  VIDEO_EXTENSIONS,
  type WorkspaceCollection
} from '$lib/types';
import { prepareImportedFiles } from '$lib/services/file-verification';
import { filesystemFolders } from '$lib/services/filesystem-folders';
import { logDebug, logError, logInfo, logWarning } from '$lib/services/logging';
import { trackSettings } from '$lib/stores/track-settings';
import {
  ensureFileHandleReadPermission,
  readDirectoryFiles,
  readFileHandleFiles
} from '$lib/utils/files';

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

const STREAM_FILE_EXTENSIONS = STREAM_EXTENSIONS.map((extension) => `.${extension}`);
const MODULE_FILE_EXTENSIONS = MODULE_EXTENSIONS.map((extension) => `.${extension}`);
const VIDEO_FILE_EXTENSIONS = VIDEO_EXTENSIONS.map((extension) => `.${extension}`);

export const FILE_INPUT_ACCEPT = [
  ...STREAM_FILE_EXTENSIONS,
  ...MODULE_FILE_EXTENSIONS,
  ...VIDEO_FILE_EXTENSIONS
].join(',');

export function createOpenFilePickerOptions(description = 'Supported media files'): OpenFilePickerOptions {
  return {
  multiple: true,
  types: [
    {
      description,
      accept: {
        'audio/mpeg': ['.mp3'],
        'audio/wav': ['.wav'],
        'audio/flac': ['.flac'],
        'audio/ogg': ['.ogg', '.opus'],
        'audio/opus': ['.opus'],
        'audio/x-openmpt': MODULE_FILE_EXTENSIONS,
        'video/mp4': ['.mp4', '.m4v'],
        'video/quicktime': ['.mov'],
        'video/webm': ['.webm'],
        'video/x-matroska': ['.mkv']
      }
    }
  ]
  };
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
        if (!handles || handles.length === 0) {
          logInfo('files', 'File picker cancelled', { target });
        }
        // Ask for persistent read access while a user gesture is available:
        // the picker's implicit grant can lapse across reloads, and later
        // handle-only materialization (e.g. host-side Freeplay playback) has
        // no gesture to prompt with. Handles the user declines are skipped.
        const grantedHandles: FileSystemFileHandle[] = [];
        for (const handle of handles ?? []) {
          const permission = await ensureFileHandleReadPermission(handle);
          if (permission === 'granted') {
            logDebug('files', 'Import handle permission granted', { name: handle.name });
            grantedHandles.push(handle);
          } else {
            logWarning('files', 'Import skipped — file handle permission not granted', {
              name: handle.name,
              permission
            });
          }
        }
        const pickedFiles = grantedHandles.length > 0
          ? await readFileHandleFiles(grantedHandles)
          : [];
        const files = await prepareImportedFiles(pickedFiles);
        logInfo('files', 'File import completed', {
          target,
          files: files.length,
          skipped: pickedFiles.length - files.length
        });

        if (files.length > 0) {
          options.addFiles(files, target);
        }
      } catch (error) {
        if (isAbortError(error)) {
          logInfo('files', 'File picker cancelled', { target });
          return;
        }

        logError('files', 'File import failed', {
          target,
          error: error instanceof Error ? error.message : String(error)
        });
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
        if (!directoryHandle) {
          logInfo('files', 'Folder picker cancelled', { target });
        } else {
          // Persistent read access to the directory covers its whole subtree;
          // without the explicit grant the imported file handles can lapse to
          // 'prompt' and later handle-only materialization silently fails.
          const permission = await ensureFileHandleReadPermission(directoryHandle);
          if (permission === 'granted') {
            logDebug('files', 'Folder read permission granted', { name: directoryHandle.name });
          } else {
            logWarning('files', 'Folder read permission not granted — imported handles may lapse', {
              name: directoryHandle.name,
              permission
            });
          }
          await filesystemFolders.remember(directoryHandle);
        }
        const discoveredFiles = directoryHandle
          ? await readDirectoryFiles(directoryHandle, {
              maxDepth: trackSettings.getSnapshot().folderNestingLimit
            })
          : [];
        const files = await prepareImportedFiles(discoveredFiles);
        logInfo('files', 'Folder import completed', {
          name: directoryHandle?.name,
          files: files.length,
          skipped: discoveredFiles.length - files.length
        });

        if (files.length > 0) {
          options.addFiles(files, target);
        }
      } catch (error) {
        if (isAbortError(error)) {
          logInfo('files', 'Folder picker cancelled', { target });
          return;
        }

        logError('files', 'Folder import failed', {
          target,
          error: error instanceof Error ? error.message : String(error)
        });
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
