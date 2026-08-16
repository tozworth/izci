import type { TroubadourRememberedFolder } from '$lib/services/troubadour-sync';
import type { TroubadourSettings } from '$lib/stores/troubadour-settings';
import type { TroubadourAutoGroupFallback } from './troubadour-controller';
import type { TroubadourTranslate } from './troubadour-dock';

export const ITEM_DRAG_MIME = 'application/x-izci-troubadour-items';

export const OPEN_FILE_OPTIONS: OpenFilePickerOptions = {
  multiple: true,
  types: [{
    description: 'Media files',
    accept: {
      'audio/mpeg': ['.mp3'], 'audio/wav': ['.wav'], 'audio/flac': ['.flac'],
      'audio/ogg': ['.ogg', '.opus'], 'audio/opus': ['.opus']
    }
  }]
};

export type TroubadourLoadingSource = 'files' | 'folder' | 'library-folder' | null;

export interface TroubadourImportTarget {
  controller: {
    ingestHandles(
      handles: FileSystemFileHandle[],
      concurrency?: number,
      autoGroupFallback?: TroubadourAutoGroupFallback
    ): Promise<void>;
    ingestDirectory(
      handle: FileSystemDirectoryHandle,
      maxDepth?: number,
      concurrency?: number,
      autoGroupFallback?: TroubadourAutoGroupFallback
    ): Promise<void>;
    ingestDropped(
      dataTransfer: DataTransfer,
      maxDepth?: number,
      concurrency?: number,
      autoGroupFallback?: TroubadourAutoGroupFallback
    ): Promise<void>;
  };
  settings: TroubadourSettings;
  translate: TroubadourTranslate;
  setLoadingSource(source: TroubadourLoadingSource): void;
  onError(error: unknown): void;
  setDragActive(active: boolean): void;
}

export function isItemDrag(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes(ITEM_DRAG_MIME);
}

export async function chooseFiles(target: TroubadourImportTarget, fileInput: HTMLInputElement): Promise<void> {
  const picker = window as Window & { showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]> };
  if (!picker.showOpenFilePicker) {
    fileInput.click();
    return;
  }
  try {
    target.setLoadingSource('files');
    await target.controller.ingestHandles(
      await picker.showOpenFilePicker(OPEN_FILE_OPTIONS),
      target.settings.metadataReadConcurrency,
      target.settings.autoGroupOnLoad ? target.settings.autoGroupFallback : undefined
    );
  } catch (error) {
    target.onError(error);
  } finally {
    target.setLoadingSource(null);
  }
}

export async function chooseFolder(target: TroubadourImportTarget): Promise<void> {
  const picker = window as Window & { showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle> };
  if (!picker.showDirectoryPicker) {
    target.onError(new Error(target.translate('troubadour.workbench.folderUnavailable', { default: 'Folder access is unavailable. Use Add files instead.' })));
    return;
  }
  try {
    const directory = await picker.showDirectoryPicker({ mode: 'read' });
    target.setLoadingSource('folder');
    await target.controller.ingestDirectory(
      directory,
      target.settings.folderScanDepth,
      target.settings.metadataReadConcurrency,
      target.settings.autoGroupOnLoad ? target.settings.autoGroupFallback : undefined
    );
  } catch (error) {
    target.onError(error);
  } finally {
    target.setLoadingSource(null);
  }
}

export async function addRememberedFolder(
  target: TroubadourImportTarget,
  folders: TroubadourRememberedFolder[],
  id: string
): Promise<void> {
  const folder = folders.find((candidate) => candidate.id === id);
  if (!folder) return;
  try {
    target.setLoadingSource('library-folder');
    await target.controller.ingestDirectory(
      folder.handle,
      target.settings.folderScanDepth,
      target.settings.metadataReadConcurrency,
      target.settings.autoGroupOnLoad ? target.settings.autoGroupFallback : undefined
    );
  } catch (error) {
    target.onError(error);
  } finally {
    target.setLoadingSource(null);
  }
}

export async function handleFileFallback(target: TroubadourImportTarget, event: Event): Promise<void> {
  const input = event.currentTarget as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  const transfer = new DataTransfer();
  files.forEach((file) => transfer.items.add(file));
  try {
    target.setLoadingSource('files');
    await target.controller.ingestDropped(
      transfer,
      target.settings.folderScanDepth,
      target.settings.metadataReadConcurrency,
      target.settings.autoGroupOnLoad ? target.settings.autoGroupFallback : undefined
    );
  } catch (error) {
    target.onError(error);
  } finally {
    target.setLoadingSource(null);
  }
}

export async function handleDrop(target: TroubadourImportTarget, event: DragEvent): Promise<void> {
  event.preventDefault();
  target.setDragActive(false);
  if (isItemDrag(event)) return;
  if (!event.dataTransfer) return;
  try {
    await target.controller.ingestDropped(
      event.dataTransfer,
      target.settings.folderScanDepth,
      target.settings.metadataReadConcurrency,
      target.settings.autoGroupOnLoad ? target.settings.autoGroupFallback : undefined
    );
  } catch (error) {
    target.onError(error);
  }
}

export function handleWindowDragOver(target: TroubadourImportTarget, event: DragEvent): void {
  if (isItemDrag(event)) {
    target.setDragActive(false);
    return;
  }
  if (!Array.from(event.dataTransfer?.types ?? []).includes('Files')) return;
  event.preventDefault();
  target.setDragActive(true);
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
}

export function handleWindowDragLeave(target: TroubadourImportTarget, event: DragEvent): void {
  if (!isItemDrag(event) && event.relatedTarget === null) target.setDragActive(false);
}
