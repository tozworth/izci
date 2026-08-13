import { describe, expect, it, vi } from 'vitest';
import {
  createBackupCoordinationClient,
  createSerializedBackupOwner,
  serveBackupOwner,
  type BackupCoordinationChannel,
  type BackupCreationResult,
  type BackupOwnerOperations
} from './backup-coordination';
import type {
  BackupManifest,
  BackupRestoreResult,
  LocateRestoreResult,
  PendingBackupRestore
} from '$lib/contracts/backup';

class ChannelHub {
  readonly channels = new Set<FakeChannel>();

  create(): FakeChannel {
    const channel = new FakeChannel(this);
    this.channels.add(channel);
    return channel;
  }

  post(sender: FakeChannel, message: unknown): void {
    for (const channel of this.channels) {
      if (channel !== sender) channel.deliver(message);
    }
  }
}

class FakeChannel implements BackupCoordinationChannel {
  private readonly listeners = new Set<(event: MessageEvent) => void>();

  constructor(private readonly hub: ChannelHub) {}

  postMessage(message: unknown): void {
    this.hub.post(this, message);
  }

  addEventListener(_type: 'message', listener: (event: MessageEvent) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'message', listener: (event: MessageEvent) => void): void {
    this.listeners.delete(listener);
  }

  close(): void {
    this.listeners.clear();
    this.hub.channels.delete(this);
  }

  deliver(data: unknown): void {
    for (const listener of this.listeners) listener({ data } as MessageEvent);
  }
}

const EMPTY_PENDING: PendingBackupRestore = {
  createdAt: '',
  sourceOrigin: '',
  folders: [],
  tracks: [],
  favorites: []
};

function manifest(libraryTracks: number): BackupManifest {
  return {
    kind: 'izci-backup',
    formatVersion: 2,
    createdAt: '2026-08-13T00:00:00.000Z',
    appVersion: '0.3.2',
    sourceOrigin: 'https://izci.test',
    contents: {
      settings: 0,
      libraryTracks,
      folders: 0,
      favorites: 0,
      playbackProgress: 0
    }
  };
}

function creation(label: string, libraryTracks: number): BackupCreationResult {
  return {
    blob: new Blob([label]),
    fileName: `${label}.izci`,
    manifest: manifest(libraryTracks)
  };
}

function restoreResult(libraryTracks: number): BackupRestoreResult {
  return {
    manifest: manifest(libraryTracks),
    settingsRestored: 0,
    tracksMatched: libraryTracks,
    tracksPending: 0,
    foldersPending: 0,
    favoritesRestored: 0,
    progressRestored: 0
  };
}

function locateResult(matchedTracks = 1): LocateRestoreResult {
  return { status: 'success', matchedTracks, remainingTracks: 0 };
}

function operations(
  overrides: Partial<BackupOwnerOperations> = {}
): BackupOwnerOperations {
  return {
    flushState: async () => undefined,
    createBackup: async () => creation('default', 0),
    restoreBackup: async () => restoreResult(0),
    locateFiles: async () => locateResult(),
    locateFolder: async () => locateResult(),
    getPendingRestore: () => EMPTY_PENDING,
    subscribePendingRestore(listener) {
      listener(EMPTY_PENDING);
      return () => undefined;
    },
    ...overrides
  };
}

function clientFor(hub: ChannelHub, standalone: BackupOwnerOperations) {
  let nextId = 0;
  return createBackupCoordinationClient({
    clientId: 'options-realm',
    createId: () => `options-request-${++nextId}`,
    scheduler: {
      setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
    },
    createChannel: () => hub.create(),
    createStandaloneOperations: async () => standalone,
    acquireStandaloneLease: async () => ({ release: () => undefined }),
    discoveryTimeoutMs: 5,
    requestTimeoutMs: 500
  });
}

describe('backup owner coordination', () => {
  it('reads a main-realm dirty catalog only after the owner flush boundary', async () => {
    const hub = new ChannelHub();
    let durableTrackCount = 1;
    const mainDirtyTrackCount = 2;
    const events: string[] = [];
    const mainOperations = operations({
      async flushState() {
        events.push('main:flush');
        durableTrackCount = mainDirtyTrackCount;
      },
      async createBackup() {
        events.push(`main:read:${durableTrackCount}`);
        return creation('main-dirty', durableTrackCount);
      }
    });
    const standaloneCreate = vi.fn(async () => creation('stale-options', 1));
    const optionsOperations = operations({ createBackup: standaloneCreate });
    const stopOwner = serveBackupOwner({
      ownerId: 'main-realm',
      channel: hub.create(),
      owner: createSerializedBackupOwner(mainOperations)
    });
    const optionsClient = clientFor(hub, optionsOperations);

    await optionsClient.ready();
    const result = await optionsClient.createBackup();

    expect(result.fileName).toBe('main-dirty.izci');
    expect(result.manifest.contents.libraryTracks).toBe(2);
    expect(events).toEqual(['main:flush', 'main:read:2']);
    expect(standaloneCreate).not.toHaveBeenCalled();

    await optionsClient.dispose();
    await stopOwner();
  });

  it('routes writes to main and serializes restore/locate before the next read', async () => {
    const hub = new ChannelHub();
    const events: string[] = [];
    let mainCatalog = 'dirty-before-restore';
    let durableCatalog = 'old-durable';
    let releaseRestore!: () => void;
    const restoreGate = new Promise<void>((resolve) => {
      releaseRestore = resolve;
    });
    const mainOperations = operations({
      async flushState() {
        events.push(`flush:${mainCatalog}`);
        durableCatalog = mainCatalog;
      },
      async restoreBackup() {
        events.push('restore:start');
        await restoreGate;
        mainCatalog = 'restored-in-main';
        events.push('restore:end');
        return restoreResult(1);
      },
      async locateFiles() {
        events.push(`locate:${durableCatalog}`);
        mainCatalog = 'located-in-main';
        return locateResult();
      },
      async createBackup() {
        events.push(`read:${durableCatalog}`);
        return creation(durableCatalog, durableCatalog === 'located-in-main' ? 2 : 0);
      }
    });
    const optionsRestore = vi.fn(async () => restoreResult(0));
    const optionsOperations = operations({ restoreBackup: optionsRestore });
    const stopOwner = serveBackupOwner({
      ownerId: 'main-realm',
      channel: hub.create(),
      owner: createSerializedBackupOwner(mainOperations)
    });
    const optionsClient = clientFor(hub, optionsOperations);
    await optionsClient.ready();

    const restore = optionsClient.restoreBackup({} as File);
    const locate = optionsClient.locateFiles([]);
    await Promise.resolve();
    expect(events).toEqual(['restore:start']);

    releaseRestore();
    await Promise.all([restore, locate]);
    const backup = await optionsClient.createBackup();

    expect(backup.fileName).toBe('located-in-main.izci');
    expect(events).toEqual([
      'restore:start',
      'restore:end',
      'flush:restored-in-main',
      'locate:restored-in-main',
      'flush:located-in-main',
      'flush:located-in-main',
      'read:located-in-main'
    ]);
    expect(optionsRestore).not.toHaveBeenCalled();

    await optionsClient.dispose();
    await stopOwner();
  });

  it('does not initialize standalone collection ownership when the lease is busy', async () => {
    const hub = new ChannelHub();
    const createStandaloneOperations = vi.fn(async () => operations());
    let nextId = 0;
    const client = createBackupCoordinationClient({
      clientId: 'options-realm',
      createId: () => `busy-request-${++nextId}`,
      scheduler: {
        setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
        clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
      },
      createChannel: () => hub.create(),
      createStandaloneOperations,
      acquireStandaloneLease: async () => null,
      discoveryTimeoutMs: 1,
      requestTimeoutMs: 100
    });

    await expect(client.createBackup()).rejects.toThrow('backup-owner-busy');
    expect(createStandaloneOperations).not.toHaveBeenCalled();
    await client.dispose();
  });

  it('waits for a main owner that is still hydrating after it acquired the lease', async () => {
    const hub = new ChannelHub();
    const createStandaloneOperations = vi.fn(async () => operations());
    let nextId = 0;
    const client = createBackupCoordinationClient({
      clientId: 'early-options',
      createId: () => `early-request-${++nextId}`,
      scheduler: {
        setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
        clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
      },
      createChannel: () => hub.create(),
      createStandaloneOperations,
      acquireStandaloneLease: async () => null,
      discoveryTimeoutMs: 2,
      requestTimeoutMs: 100
    });

    const readiness = client.ready();
    await new Promise((resolve) => setTimeout(resolve, 8));
    const stopOwner = serveBackupOwner({
      ownerId: 'hydrated-main',
      channel: hub.create(),
      owner: createSerializedBackupOwner(operations())
    });

    await expect(readiness).resolves.toBeUndefined();
    expect(createStandaloneOperations).not.toHaveBeenCalled();
    await client.dispose();
    await stopOwner();
  });

  it('retains a standalone lease until after domain state has been disposed', async () => {
    const hub = new ChannelHub();
    const events: string[] = [];
    let nextId = 0;
    const client = createBackupCoordinationClient({
      clientId: 'standalone-options',
      createId: () => `standalone-request-${++nextId}`,
      scheduler: {
        setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
        clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
      },
      createChannel: () => hub.create(),
      createStandaloneOperations: async () => operations({
        async disposeState() {
          events.push('state:dispose');
        }
      }),
      acquireStandaloneLease: async () => ({
        release() {
          events.push('lease:release');
        }
      }),
      discoveryTimeoutMs: 1,
      requestTimeoutMs: 100
    });
    await client.ready();

    await client.stop();
    expect(events).toEqual(['state:dispose']);

    await client.dispose();
    expect(events).toEqual(['state:dispose', 'lease:release']);
  });
});
