import { cancelLibraryFolderScan, scanLibraryFolder } from '$lib/services/library-folder-scanner';

const CHANNEL_NAME = 'izci-library-folder-commands';
let commandChannel: BroadcastChannel | null = null;

export interface LibraryFolderCommand {
  type: 'scan' | 'cancel';
  folderId: string;
}

function isCommand(value: unknown): value is LibraryFolderCommand {
  if (!value || typeof value !== 'object') return false;
  const source = value as Partial<LibraryFolderCommand>;
  return (source.type === 'scan' || source.type === 'cancel') && typeof source.folderId === 'string';
}

export function requestLibraryFolderScan(folderId: string): boolean {
  if (typeof BroadcastChannel === 'undefined') return false;
  commandChannel ??= new BroadcastChannel(CHANNEL_NAME);
  commandChannel.postMessage({ type: 'scan', folderId } satisfies LibraryFolderCommand);
  return true;
}

export function requestLibraryFolderScanCancellation(folderId: string): boolean {
  if (typeof BroadcastChannel === 'undefined') return false;
  commandChannel ??= new BroadcastChannel(CHANNEL_NAME);
  commandChannel.postMessage({ type: 'cancel', folderId } satisfies LibraryFolderCommand);
  return true;
}

export function startLibraryFolderCommandListener(): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  const channel = new BroadcastChannel(CHANNEL_NAME);
  const handleMessage = (event: MessageEvent) => {
    if (!isCommand(event.data)) return;
    if (event.data.type === 'cancel') {
      cancelLibraryFolderScan(event.data.folderId);
      return;
    }
    void scanLibraryFolder(event.data.folderId);
  };
  channel.addEventListener('message', handleMessage);
  return () => channel.close();
}
