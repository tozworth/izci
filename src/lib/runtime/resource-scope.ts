import { DomainError, toDomainError, type SafeErrorCause } from './errors';
import type { ClockPort, IdPort } from './ports';

export type ResourceKind =
  | 'abort-controller'
  | 'animation-frame'
  | 'broadcast-channel'
  | 'child-scope'
  | 'event-listener'
  | 'interval'
  | 'object-url'
  | 'timeout'
  | 'worker';

export type ResourceState =
  | 'active'
  | 'releasing'
  | 'released'
  | 'release-failed'
  | 'acquisition-failed';

export interface ResourceDescriptor {
  readonly kind: ResourceKind;
  readonly label: string;
}

export interface ResourceDiagnostic extends ResourceDescriptor {
  readonly id: string;
  readonly state: ResourceState;
  readonly registeredAt: number;
  readonly settledAt?: number;
  readonly error?: SafeErrorCause;
}

export interface ResourceReleaseResult extends ResourceDescriptor {
  readonly id: string;
  readonly ok: boolean;
  readonly error?: DomainError;
}

export interface ScopeDisposalReport {
  readonly scopeId: string;
  readonly label: string;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly released: number;
  readonly failures: readonly ResourceReleaseResult[];
  readonly resources: readonly ResourceDiagnostic[];
}

export interface ScopeDiagnostic {
  readonly id: string;
  readonly label: string;
  readonly state: 'active' | 'disposing' | 'disposed';
  readonly counts: ResourceDiagnosticCounts;
  readonly resources: readonly ResourceDiagnostic[];
}

export interface ResourceDiagnosticCounts {
  readonly active: number;
  readonly peak: number;
  readonly released: number;
  readonly acquisitionFailures: number;
  readonly releaseFailures: number;
}

export interface OwnedResource<T> {
  readonly value: T;
  readonly registration: ResourceRegistration;
}

export interface ResourceRegistration extends ResourceDescriptor {
  readonly id: string;
  release(): Promise<ResourceReleaseResult>;
  complete(): ResourceReleaseResult;
  diagnostic(): ResourceDiagnostic;
}

interface MutableDiagnostic {
  id: string;
  kind: ResourceKind;
  label: string;
  state: ResourceState;
  registeredAt: number;
  settledAt?: number;
  error?: SafeErrorCause;
}

function copyDiagnostic(diagnostic: MutableDiagnostic): ResourceDiagnostic {
  return { ...diagnostic };
}

export class ResourceScope {
  readonly id: string;
  readonly label: string;

  #state: 'active' | 'disposing' | 'disposed' = 'active';
  #entries: ResourceRegistration[] = [];
  #diagnostics: MutableDiagnostic[] = [];
  #disposePromise?: Promise<ScopeDisposalReport>;
  #parentRegistration?: ResourceRegistration;
  #peakActive = 0;

  constructor(
    label: string,
    private readonly clock: ClockPort,
    private readonly ids: IdPort
  ) {
    this.id = ids.create();
    this.label = label;
  }

  diagnostic(): ScopeDiagnostic {
    return {
      id: this.id,
      label: this.label,
      state: this.#state,
      counts: this.#counts(),
      resources: this.#diagnostics.map(copyDiagnostic)
    };
  }

  register(descriptor: ResourceDescriptor, releaseResource: () => void | Promise<void>): ResourceRegistration {
    this.#assertActive(`register ${descriptor.kind}:${descriptor.label}`);
    const diagnostic: MutableDiagnostic = {
      id: this.ids.create(),
      ...descriptor,
      state: 'active',
      registeredAt: this.clock.monotonicNow()
    };
    this.#diagnostics.push(diagnostic);
    this.#peakActive = Math.max(this.#peakActive, this.#counts().active);
    let releasePromise: Promise<ResourceReleaseResult> | undefined;

    const complete = (): ResourceReleaseResult => {
      if (diagnostic.state === 'active') {
        diagnostic.state = 'released';
        diagnostic.settledAt = this.clock.monotonicNow();
      }
      return { id: diagnostic.id, ...descriptor, ok: diagnostic.state === 'released' };
    };
    const release = (): Promise<ResourceReleaseResult> => {
      if (releasePromise) return releasePromise;
      if (diagnostic.state === 'released') return Promise.resolve(complete());
      diagnostic.state = 'releasing';
      const failed = (cause: unknown): ResourceReleaseResult => {
        const error = toDomainError(cause, `release ${descriptor.kind}:${descriptor.label}`, 'runtime.release-failed');
        diagnostic.state = 'release-failed';
        diagnostic.settledAt = this.clock.monotonicNow();
        diagnostic.error = error.safeCause ?? { name: error.name, message: error.message };
        return { id: diagnostic.id, ...descriptor, ok: false, error };
      };
      try {
        const result = releaseResource();
        releasePromise = Promise.resolve(result).then(() => {
          diagnostic.state = 'released';
          diagnostic.settledAt = this.clock.monotonicNow();
          return { id: diagnostic.id, ...descriptor, ok: true };
        }, failed);
      } catch (cause) {
        releasePromise = Promise.resolve(failed(cause));
      }
      return releasePromise;
    };

    const registration: ResourceRegistration = {
      id: diagnostic.id,
      ...descriptor,
      release,
      complete,
      diagnostic: () => copyDiagnostic(diagnostic)
    };
    this.#entries.push(registration);
    return registration;
  }

  own<T>(descriptor: ResourceDescriptor, value: T, release: (value: T) => void | Promise<void>): OwnedResource<T> {
    const registration = this.register(descriptor, () => release(value));
    return { value, registration };
  }

  async acquire<T>(
    descriptor: ResourceDescriptor,
    acquireResource: () => T | Promise<T>,
    releaseResource: (value: T) => void | Promise<void>
  ): Promise<OwnedResource<T>> {
    this.#assertActive(`acquire ${descriptor.kind}:${descriptor.label}`);
    try {
      const value = await acquireResource();
      if (this.#state !== 'active') {
        await releaseResource(value);
        throw new DomainError({
          category: 'stale',
          code: 'runtime.scope-settled-during-acquisition',
          operation: `acquire ${descriptor.kind}:${descriptor.label}`,
          retryable: true
        });
      }
      return this.own(descriptor, value, releaseResource);
    } catch (cause) {
      this.#recordAcquisitionFailure(descriptor, cause);
      throw toDomainError(cause, `acquire ${descriptor.kind}:${descriptor.label}`, 'runtime.acquisition-failed');
    }
  }

  createChild(label: string): ResourceScope {
    const child = new ResourceScope(label, this.clock, this.ids);
    child.#parentRegistration = this.register(
      { kind: 'child-scope', label },
      async () => { await child.dispose(); }
    );
    return child;
  }

  async replaceChild(current: ResourceScope | undefined, label: string): Promise<ResourceScope> {
    if (current) await current.dispose();
    this.#assertActive(`replace child:${label}`);
    return this.createChild(label);
  }

  dispose(): Promise<ScopeDisposalReport> {
    if (this.#disposePromise) return this.#disposePromise;
    this.#state = 'disposing';
    const startedAt = this.clock.monotonicNow();
    this.#disposePromise = (async () => {
      const releases = [...this.#entries].reverse().map((entry) => entry.release());
      const results = await Promise.all(releases);
      this.#state = 'disposed';
      this.#parentRegistration?.complete();
      const failures = results.filter((result) => !result.ok);
      return {
        scopeId: this.id,
        label: this.label,
        startedAt,
        completedAt: this.clock.monotonicNow(),
        released: results.length - failures.length,
        failures,
        resources: this.#diagnostics.map(copyDiagnostic)
      };
    })();
    return this.#disposePromise;
  }

  #assertActive(operation: string): void {
    if (this.#state === 'active') return;
    throw new DomainError({
      category: 'stale',
      code: 'runtime.scope-not-active',
      operation,
      retryable: false,
      message: `Resource scope "${this.label}" is ${this.#state}`
    });
  }

  #recordAcquisitionFailure(descriptor: ResourceDescriptor, cause: unknown): void {
    const error = toDomainError(cause, `acquire ${descriptor.kind}:${descriptor.label}`, 'runtime.acquisition-failed');
    this.#diagnostics.push({
      id: this.ids.create(),
      ...descriptor,
      state: 'acquisition-failed',
      registeredAt: this.clock.monotonicNow(),
      settledAt: this.clock.monotonicNow(),
      error: error.safeCause ?? { name: error.name, message: error.message }
    });
  }

  #counts(): ResourceDiagnosticCounts {
    return {
      active: this.#diagnostics.filter(({ state }) => state === 'active' || state === 'releasing').length,
      peak: this.#peakActive,
      released: this.#diagnostics.filter(({ state }) => state === 'released').length,
      acquisitionFailures: this.#diagnostics.filter(({ state }) => state === 'acquisition-failed').length,
      releaseFailures: this.#diagnostics.filter(({ state }) => state === 'release-failed').length
    };
  }
}
