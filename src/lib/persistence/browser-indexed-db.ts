import { BrowserClock } from '$lib/runtime/adapters/browser-clock';
import { BrowserId } from '$lib/runtime/adapters/browser-id';
import { ResourceScope, type ScopeDisposalReport } from '$lib/runtime/resource-scope';
import {
  openDatabase,
  type DatabaseConnection,
  type DatabaseSpec,
  type IndexedDbFactoryPort
} from './indexed-db';

let scope: ResourceScope | null = null;
const owners = new Set<BrowserPersistenceOwner>();

export interface BrowserPersistenceOwner {
  readonly label: string;
  flush?(): void | Promise<void>;
  dispose(): void | Promise<void>;
}

export function registerBrowserPersistenceOwner(owner: BrowserPersistenceOwner): () => void {
  owners.add(owner);
  return () => owners.delete(owner);
}

export async function disposeBrowserPersistenceOwners(): Promise<void> {
  const active = [...owners];
  owners.clear();
  const results = await Promise.allSettled(active.map(async (owner) => {
    await owner.flush?.();
    await owner.dispose();
  }));
  const failures = results.flatMap((result, index) => result.status === 'rejected'
    ? [{ label: active[index]?.label ?? 'unknown', error: result.reason }]
    : []);
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((failure) => failure.error),
      `Browser persistence shutdown failed: ${failures.map((failure) => failure.label).join(', ')}`
    );
  }
}

function browserTarget(): (Window & typeof globalThis) | null {
  return typeof window === 'undefined' ? null : window;
}

function browserFactory(target: Window & typeof globalThis): IndexedDbFactoryPort | null {
  return 'indexedDB' in target ? target.indexedDB : null;
}

function browserScope(target: Window & typeof globalThis): ResourceScope {
  if (scope) return scope;
  scope = new ResourceScope(
    'browser persistence',
    new BrowserClock(target, () => target.Date.now(), () => target.performance.now()),
    new BrowserId(target.crypto)
  );
  return scope;
}

export function openBrowserDatabase<TSpec extends DatabaseSpec>(
  spec: TSpec
): Promise<DatabaseConnection<TSpec>> {
  const target = browserTarget();
  if (!target) {
    return openDatabase(spec, null, null);
  }
  return openDatabase(spec, browserScope(target), browserFactory(target));
}

export function disposeBrowserDatabases(): Promise<ScopeDisposalReport | null> {
  const current = scope;
  scope = null;
  return current ? current.dispose() : Promise.resolve(null);
}
