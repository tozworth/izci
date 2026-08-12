import type {
  CapabilityPort,
  DirectoryPickerOptions,
  RuntimeCapability,
  SaveFilePickerOptions
} from '../ports';

interface CapabilityTarget extends Window {
  readonly AbortController: typeof AbortController;
  readonly BroadcastChannel: typeof BroadcastChannel;
  readonly URL: typeof URL;
  readonly Worker: typeof Worker;
  showDirectoryPicker?: (options?: DirectoryPickerOptions) => Promise<FileSystemDirectoryHandle>;
  showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
}

export class BrowserCapabilities implements CapabilityPort {
  constructor(private readonly target: CapabilityTarget) {}

  has(capability: RuntimeCapability): boolean {
    switch (capability) {
      case 'abort-controller': return typeof this.target.AbortController === 'function';
      case 'animation-frame': return typeof this.target.requestAnimationFrame === 'function';
      case 'broadcast-channel': return typeof this.target.BroadcastChannel === 'function';
      case 'directory-picker': return typeof this.target.showDirectoryPicker === 'function';
      case 'file-picker': return typeof this.target.showOpenFilePicker === 'function';
      case 'key-value-storage': return 'localStorage' in this.target;
      case 'object-url': return typeof this.target.URL?.createObjectURL === 'function';
      case 'save-file-picker': return typeof this.target.showSaveFilePicker === 'function';
      case 'worker': return typeof this.target.Worker === 'function';
    }
  }
}
