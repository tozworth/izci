export interface ClockPort {
  wallNow(): number;
  monotonicNow(): number;
  queueMicrotask(callback: () => void): void;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(callback: () => void, delayMs: number): unknown;
  clearInterval(handle: unknown): void;
  requestAnimationFrame(callback: (time: number) => void): unknown;
  cancelAnimationFrame(handle: unknown): void;
}

export interface IdPort {
  create(): string;
}

export type RuntimeCapability =
  | 'abort-controller'
  | 'animation-frame'
  | 'broadcast-channel'
  | 'directory-picker'
  | 'file-picker'
  | 'key-value-storage'
  | 'object-url'
  | 'save-file-picker'
  | 'worker';

export interface CapabilityPort {
  has(capability: RuntimeCapability): boolean;
}

export interface KeyValueStoragePort {
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
  subscribe(listener: (change: KeyValueStorageChange) => void): () => void;
}

export interface KeyValueStorageChange {
  readonly key: string;
  readonly oldValue: string | null;
  readonly newValue: string | null;
  readonly source: 'local' | 'external';
}

export interface DirectoryPickerOptions {
  readonly id?: string;
  readonly mode?: 'read' | 'readwrite';
}

export interface SaveFilePickerOptions {
  readonly excludeAcceptAllOption?: boolean;
  readonly id?: string;
  readonly suggestedName?: string;
  readonly types?: FilePickerAcceptType[];
}

export interface FileAccessPort {
  openFiles(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>;
  openDirectory(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>;
  saveFile(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>;
}

export type ViteWorkerConstructor<TWorker extends Worker = Worker> = new () => TWorker;

export interface WorkerPort {
  create<TWorker extends Worker>(constructor: ViteWorkerConstructor<TWorker>): TWorker;
}

export interface AbortControllerPort {
  create(): AbortController;
}

export interface BroadcastChannelPort {
  create(name: string): BroadcastChannel;
}

export interface ObjectUrlPort {
  create(blob: Blob): string;
  revoke(url: string): void;
}
