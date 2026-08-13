import { toDomainError, type DomainError } from './errors';
import type { PageRuntime } from './page-runtime';
import type { ScopeDisposalReport } from './resource-scope';

export interface PageHideEventPort {
  readonly persisted: boolean;
}

export type PageHideListener = (event: PageHideEventPort) => void;

/** The deliberately small part of Window used by page bootstrap. */
export interface PageLifecycleTargetPort {
  addEventListener(type: 'pagehide', listener: PageHideListener): void;
  removeEventListener(type: 'pagehide', listener: PageHideListener): void;
}

export type PageCleanup = () => void | Promise<void>;

/**
 * An initializer may return ownership of the effect it installed. Bootstrap
 * registers that cleanup with the page's root ResourceScope.
 */
export type PageInitializer = (
  runtime: PageRuntime
) => void | PageCleanup | Promise<void | PageCleanup>;

export type PageBootstrapPhase =
  | 'logger'
  | 'settings'
  | 'service-worker'
  | 'theme'
  | 'mobile-document'
  | 'scrollbar'
  | 'localization'
  | 'popup-orphan'
  | 'mount'
  | 'readiness'
  | 'marker';

export interface PageBootstrapConfig {
  readonly pageId: string;
  readonly runtime: PageRuntime;
  readonly lifecycle: PageLifecycleTargetPort;
  readonly production: boolean;
  readonly logger: PageInitializer;
  /** Registers page teardown for module-owned synchronized settings stores. */
  readonly settings: PageInitializer;
  /** Invoked only when `production` is true. */
  readonly serviceWorker: PageInitializer;
  readonly theme: PageInitializer;
  readonly mobileDocument?: PageInitializer;
  readonly scrollbar: PageInitializer;
  readonly localization: PageInitializer;
  readonly popupOrphan?: PageInitializer;
  /** The cleanup returned by this hook is the page's unmount operation. */
  readonly mount: PageInitializer;
  readonly readiness: PageInitializer;
  /** An injected document-marker adapter; bootstrap itself uses no globals. */
  readonly marker: PageInitializer;
}

export interface PageBootstrapReadyResult {
  readonly status: 'ready';
  readonly pageId: string;
}

export interface PageBootstrapFailedResult {
  readonly status: 'failed';
  readonly pageId: string;
  readonly phase: PageBootstrapPhase;
  readonly error: DomainError;
  readonly disposal: ScopeDisposalReport;
}

export interface PageBootstrapDestroyedResult {
  readonly status: 'destroyed';
  readonly pageId: string;
  readonly disposal: ScopeDisposalReport;
}

export type PageBootstrapReadinessResult =
  | PageBootstrapReadyResult
  | PageBootstrapFailedResult
  | PageBootstrapDestroyedResult;

export interface PageBootstrapHandle {
  readonly pageId: string;
  readonly readiness: Promise<PageBootstrapReadinessResult>;
  destroy(): Promise<ScopeDisposalReport>;
}

interface OrderedInitializer {
  readonly phase: PageBootstrapPhase;
  readonly initialize: PageInitializer;
}

function orderedInitializers(config: PageBootstrapConfig): OrderedInitializer[] {
  return [
    { phase: 'logger', initialize: config.logger },
    { phase: 'settings', initialize: config.settings },
    ...(config.production
      ? [{ phase: 'service-worker' as const, initialize: config.serviceWorker }]
      : []),
    { phase: 'theme', initialize: config.theme },
    ...(config.mobileDocument
      ? [{ phase: 'mobile-document' as const, initialize: config.mobileDocument }]
      : []),
    { phase: 'scrollbar', initialize: config.scrollbar },
    { phase: 'localization', initialize: config.localization },
    ...(config.popupOrphan
      ? [{ phase: 'popup-orphan' as const, initialize: config.popupOrphan }]
      : []),
    { phase: 'mount', initialize: config.mount },
    { phase: 'readiness', initialize: config.readiness },
    { phase: 'marker', initialize: config.marker }
  ];
}

/**
 * Runs one page's explicit bootstrap sequence and makes every resulting effect
 * subordinate to the supplied root ResourceScope.
 */
export function bootstrapPage(config: PageBootstrapConfig): PageBootstrapHandle {
  const { pageId, runtime } = config;
  let destroyRequested = false;
  let destroyPromise: Promise<ScopeDisposalReport> | undefined;

  const destroy = (): Promise<ScopeDisposalReport> => {
    destroyRequested = true;
    destroyPromise ??= runtime.scope.dispose();
    return destroyPromise;
  };

  const handlePageHide: PageHideListener = (event) => {
    if (!event.persisted) void destroy();
  };
  config.lifecycle.addEventListener('pagehide', handlePageHide);
  try {
    runtime.scope.register(
      { kind: 'event-listener', label: `${pageId} pagehide` },
      () => config.lifecycle.removeEventListener('pagehide', handlePageHide)
    );
  } catch (error) {
    config.lifecycle.removeEventListener('pagehide', handlePageHide);
    throw error;
  }

  const registerCleanup = async (
    phase: PageBootstrapPhase,
    cleanup: PageCleanup
  ): Promise<void> => {
    if (destroyRequested) {
      await cleanup();
      return;
    }
    try {
      runtime.scope.register(
        { kind: 'lifecycle', label: `${pageId} ${phase} cleanup` },
        cleanup
      );
    } catch (error) {
      await cleanup();
      throw error;
    }
  };

  const readiness = (async (): Promise<PageBootstrapReadinessResult> => {
    let activePhase: PageBootstrapPhase = 'logger';
    try {
      for (const initializer of orderedInitializers(config)) {
        activePhase = initializer.phase;
        if (destroyRequested) {
          return { status: 'destroyed', pageId, disposal: await destroy() };
        }
        const cleanup = await initializer.initialize(runtime);
        if (typeof cleanup === 'function') {
          await registerCleanup(initializer.phase, cleanup);
        }
      }

      if (destroyRequested) {
        return { status: 'destroyed', pageId, disposal: await destroy() };
      }
      return { status: 'ready', pageId };
    } catch (cause) {
      const error = toDomainError(
        cause,
        `bootstrap ${pageId} ${activePhase}`,
        'page-bootstrap.initialization-failed'
      );
      return {
        status: 'failed',
        pageId,
        phase: activePhase,
        error,
        disposal: await destroy()
      };
    }
  })();

  return { pageId, readiness, destroy };
}
