import { readFileHandleFiles } from '../web-file-handles';

type LaunchedFilesListener = (files: File[]) => void | Promise<void>;
type LaunchedHandlesPreviewListener = (handles: FileSystemFileHandle[]) => void;
type PrimaryInstanceRecord = {
  id: string;
  updatedAt: number;
};
type FileLaunchCoordinationMessage =
  | {
      type: 'primary-probe';
      requestId: string;
      sourceId: string;
    }
  | {
      type: 'primary-available';
      requestId: string;
      primaryId: string;
    }
  | {
      type: 'launched-file-handles';
      targetId: string;
      handles: FileSystemFileHandle[];
    };

export const FILE_LAUNCH_WINDOW_QUERY_KEY = 'filelaunch';

/**
 * Detect a cold file-association launch synchronously from the navigation URL
 * (the manifest file-handler action carries the marker) and strip it so
 * reloads don't re-arm the boot veil. Returns true when this window was
 * opened via file association.
 */
export function consumeFileLaunchMarker(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  let params: URLSearchParams;

  try {
    params = new URLSearchParams(window.location.search);
  } catch {
    return false;
  }

  if (!params.has(FILE_LAUNCH_WINDOW_QUERY_KEY)) {
    return false;
  }

  params.delete(FILE_LAUNCH_WINDOW_QUERY_KEY);
  const query = params.toString();

  try {
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`
    );
  } catch {
    // The marker is cosmetic; a stale URL only risks a redundant veil.
  }

  return true;
}

const pendingFileBatches: File[][] = [];
let activeListener: LaunchedFilesListener | null = null;
let previewListener: LaunchedHandlesPreviewListener | null = null;
let launchQueueInitialized = false;
let flushPromise: Promise<void> | null = null;
let coordinationInitialized = false;
let heartbeatTimer: number | null = null;
let broadcastChannel: BroadcastChannel | null = null;

const FILE_LAUNCH_COORDINATION_CHANNEL = 'izci-file-launch-coordination';
const FILE_LAUNCH_PRIMARY_STORAGE_KEY = 'izci.file-launch.primary.v1';
const FILE_LAUNCH_PRIMARY_TTL_MS = 15_000;
const FILE_LAUNCH_PRIMARY_HEARTBEAT_MS = 5_000;
const FILE_LAUNCH_PROBE_TIMEOUT_MS = 300;
const instanceId = createInstanceId();
const pendingPrimaryResolvers = new Map<string, (primaryId: string | null) => void>();

function reportLaunchError(error: unknown): void {
  console.error('Failed to process launched files.', error);
}

function createInstanceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `izci-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createCoordinationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `launch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function closeCurrentWindow(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.close();

  if (!window.closed) {
    window.location.replace('about:blank');
  }
}

function focusCurrentWindow(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.focus();
}

function readPrimaryInstanceRecord(): PrimaryInstanceRecord | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(FILE_LAUNCH_PRIMARY_STORAGE_KEY);

    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue) as Partial<PrimaryInstanceRecord>;

    if (typeof parsed.id !== "string" || typeof parsed.updatedAt !== "number") {
      return null;
    }

    return {
      id: parsed.id,
      updatedAt: parsed.updatedAt
    };
  } catch {
    return null;
  }
}

function isFreshPrimaryInstanceRecord(record: PrimaryInstanceRecord | null): record is PrimaryInstanceRecord {
  return Boolean(record && Date.now() - record.updatedAt <= FILE_LAUNCH_PRIMARY_TTL_MS);
}

function writePrimaryInstanceRecord(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(
    FILE_LAUNCH_PRIMARY_STORAGE_KEY,
    JSON.stringify({
      id: instanceId,
      updatedAt: Date.now()
    } satisfies PrimaryInstanceRecord)
  );
}

function stopPrimaryHeartbeat(): void {
  if (heartbeatTimer === null || typeof window === 'undefined') {
    return;
  }

  window.clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

function startPrimaryHeartbeat(): void {
  if (heartbeatTimer !== null || typeof window === 'undefined') {
    return;
  }

  heartbeatTimer = window.setInterval(() => {
    const currentRecord = readPrimaryInstanceRecord();

    if (currentRecord && currentRecord.id !== instanceId && isFreshPrimaryInstanceRecord(currentRecord)) {
      stopPrimaryHeartbeat();
      return;
    }

    writePrimaryInstanceRecord();
  }, FILE_LAUNCH_PRIMARY_HEARTBEAT_MS);
}

function claimPrimaryInstanceIfNeeded(force = false): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const currentRecord = readPrimaryInstanceRecord();

  if (
    force ||
    currentRecord?.id === instanceId ||
    !isFreshPrimaryInstanceRecord(currentRecord)
  ) {
    writePrimaryInstanceRecord();
    startPrimaryHeartbeat();
    return true;
  }

  stopPrimaryHeartbeat();
  return false;
}

function releasePrimaryInstanceIfCurrent(): void {
  if (typeof window === 'undefined') {
    return;
  }

  stopPrimaryHeartbeat();

  const currentRecord = readPrimaryInstanceRecord();

  if (currentRecord?.id === instanceId) {
    window.localStorage.removeItem(FILE_LAUNCH_PRIMARY_STORAGE_KEY);
  }
}

function handleCoordinationMessage(event: MessageEvent<FileLaunchCoordinationMessage>): void {
  const message = event.data;

  switch (message.type) {
    case 'primary-probe':
      if (message.sourceId === instanceId) {
        return;
      }

      if (!claimPrimaryInstanceIfNeeded()) {
        return;
      }

      broadcastChannel?.postMessage({
        type: 'primary-available',
        requestId: message.requestId,
        primaryId: instanceId
      } satisfies FileLaunchCoordinationMessage);
      return;
    case 'primary-available': {
      const resolve = pendingPrimaryResolvers.get(message.requestId);

      if (!resolve) {
        return;
      }

      pendingPrimaryResolvers.delete(message.requestId);
      resolve(message.primaryId);
      return;
    }
    case 'launched-file-handles':
      if (message.targetId !== instanceId) {
        return;
      }

      notifyHandlesPreview(message.handles);
      claimPrimaryInstanceIfNeeded(true);
      void enqueueLaunchedFileHandles(message.handles).catch(reportLaunchError);
      focusCurrentWindow();
      return;
  }
}

function initializeCoordination(): void {
  if (coordinationInitialized || typeof window === 'undefined') {
    return;
  }

  coordinationInitialized = true;
  claimPrimaryInstanceIfNeeded();

  if ('BroadcastChannel' in window) {
    broadcastChannel = new BroadcastChannel(FILE_LAUNCH_COORDINATION_CHANNEL);
    broadcastChannel.addEventListener('message', handleCoordinationMessage);
  }

  window.addEventListener('storage', (event) => {
    if (event.key !== FILE_LAUNCH_PRIMARY_STORAGE_KEY) {
      return;
    }

    const currentRecord = readPrimaryInstanceRecord();

    if (currentRecord?.id !== instanceId && isFreshPrimaryInstanceRecord(currentRecord)) {
      stopPrimaryHeartbeat();
    }
  });
  window.addEventListener('beforeunload', releasePrimaryInstanceIfCurrent);
}

async function findPrimaryInstance(): Promise<string | null> {
  initializeCoordination();

  const currentRecord = readPrimaryInstanceRecord();

  if (currentRecord?.id === instanceId && isFreshPrimaryInstanceRecord(currentRecord)) {
    return null;
  }

  if (!broadcastChannel) {
    claimPrimaryInstanceIfNeeded(true);
    return null;
  }

  const requestId = createCoordinationId();
  const primaryId = await new Promise<string | null>((resolve) => {
    const timeoutId = window.setTimeout(() => {
      pendingPrimaryResolvers.delete(requestId);
      resolve(null);
    }, FILE_LAUNCH_PROBE_TIMEOUT_MS);

    pendingPrimaryResolvers.set(requestId, (primaryId) => {
      window.clearTimeout(timeoutId);
      resolve(primaryId);
    });
    broadcastChannel?.postMessage({
      type: 'primary-probe',
      requestId,
      sourceId: instanceId
    } satisfies FileLaunchCoordinationMessage);
  });

  if (primaryId) {
    return primaryId;
  }

  claimPrimaryInstanceIfNeeded(true);
  return null;
}

async function relayLaunchedFileHandlesToPrimary(handles: FileSystemFileHandle[]): Promise<boolean> {
  const primaryId = await findPrimaryInstance();

  if (!primaryId || !broadcastChannel) {
    claimPrimaryInstanceIfNeeded(true);
    return false;
  }

  try {
    broadcastChannel.postMessage({
      type: 'launched-file-handles',
      targetId: primaryId,
      handles
    } satisfies FileLaunchCoordinationMessage);
  } catch {
    claimPrimaryInstanceIfNeeded(true);
    return false;
  }

  closeCurrentWindow();
  return true;
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

async function enqueueLaunchedFileHandles(handles: FileSystemFileHandle[]): Promise<void> {
  const files = await readFileHandleFiles(handles);

  if (files.length > 0) enqueueLaunchedFiles(files);
}

function notifyHandlesPreview(handles: FileSystemFileHandle[]): void {
  if (!previewListener) {
    return;
  }

  try {
    previewListener(handles);
  } catch (error) {
    reportLaunchError(error);
  }
}

export function setLaunchedHandlesPreviewListener(
  listener: LaunchedHandlesPreviewListener | null
): void {
  previewListener = listener;
}

async function handleLaunch(launchParams: LaunchParams): Promise<void> {
  const handles = getLaunchFileHandles(launchParams);

  if (handles.length === 0) {
    return;
  }

  notifyHandlesPreview(handles);

  if (await relayLaunchedFileHandlesToPrimary(handles)) {
    return;
  }

  await enqueueLaunchedFileHandles(handles);
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
  initializeCoordination();
  ensureLaunchQueue();
  activeListener = listener;
  void flushPendingFileBatches().catch(reportLaunchError);

  return () => {
    if (activeListener === listener) {
      activeListener = null;
    }
  };
}
