import { DomainError, toDomainError } from '../errors';
import type { DirectoryPickerOptions, FileAccessPort, SaveFilePickerOptions } from '../ports';

export interface FileAccessWindow {
  showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>;
  showDirectoryPicker?: (options?: DirectoryPickerOptions) => Promise<FileSystemDirectoryHandle>;
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
}

function unavailable(operation: string): DomainError {
  return new DomainError({
    category: 'unavailable',
    code: 'runtime.file-access-unavailable',
    operation,
    retryable: false
  });
}

export class BrowserFileAccess implements FileAccessPort {
  constructor(private readonly target: FileAccessWindow) {}

  async openFiles(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]> {
    const operation = 'open files';
    if (!this.target.showOpenFilePicker) throw unavailable(operation);
    try {
      return await this.target.showOpenFilePicker(options);
    } catch (cause) {
      throw toDomainError(cause, operation, 'runtime.open-files-failed');
    }
  }

  async openDirectory(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle> {
    const operation = 'open directory';
    if (!this.target.showDirectoryPicker) throw unavailable(operation);
    try {
      return await this.target.showDirectoryPicker(options);
    } catch (cause) {
      throw toDomainError(cause, operation, 'runtime.open-directory-failed');
    }
  }

  async saveFile(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle> {
    const operation = 'save file';
    if (!this.target.showSaveFilePicker) throw unavailable(operation);
    try {
      return await this.target.showSaveFilePicker(options);
    } catch (cause) {
      throw toDomainError(cause, operation, 'runtime.save-file-failed');
    }
  }
}
