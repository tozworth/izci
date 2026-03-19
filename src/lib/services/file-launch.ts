import { readFileHandleFiles } from '$lib/utils/files';

type LaunchedFilesListener = (files: File[]) => void | Promise<void>;

const pendingFileBatches: File[][] = [];
let activeListener: LaunchedFilesListener | null = null;
let launchQueueInitialized = false;
let flushPromise: Promise<void> | null = null;

function reportLaunchError(error: unknown): void {
  console.error('Failed to process launched files.', error);
}

function getLaunchFileHandles(launchParams: LaunchParams): FileSystemFileHandle[] {
  return (launchParams.files ?? []).filter(
    (handle): handle is FileSystemFileHandle => handle.kind === 'file'
  );
}

async function flushPendingFileBatches(): Promise<void> {
  if (flushPromise) {
    return await flushPromise;
  }

  flushPromise = (async () => {
    while (activeListener && pendingFileBatches.length > 0) {
      const files = pendingFileBatches.shift();

      if (!files) {
        continue;
      }

      try {
        await activeListener(files);
      } catch (error) {
        reportLaunchError(error);
      }
    }
  })();

  try {
    await flushPromise;
  } finally {
    flushPromise = null;
  }
}

function enqueueLaunchedFiles(files: File[]): void {
  pendingFileBatches.push(files);
  void flushPendingFileBatches().catch(reportLaunchError);
}

async function handleLaunch(launchParams: LaunchParams): Promise<void> {
  const handles = getLaunchFileHandles(launchParams);

  if (handles.length === 0) {
    return;
  }

  const files = await readFileHandleFiles(handles);

  if (files.length === 0) {
    return;
  }

  enqueueLaunchedFiles(files);
}

function ensureLaunchQueue(): void {
  if (launchQueueInitialized || typeof window === 'undefined' || !window.launchQueue) {
    return;
  }

  launchQueueInitialized = true;
  window.launchQueue.setConsumer((launchParams) => {
    void handleLaunch(launchParams).catch(reportLaunchError);
  });
}

export function subscribeToLaunchedFiles(listener: LaunchedFilesListener): () => void {
  ensureLaunchQueue();
  activeListener = listener;
  void flushPendingFileBatches().catch(reportLaunchError);

  return () => {
    if (activeListener === listener) {
      activeListener = null;
    }
  };
}
