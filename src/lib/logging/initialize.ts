import { version as appVersion } from '../../../package.json';
import type { PageRuntime } from '$lib/runtime/page-runtime';
import { ResourceScope, type ScopeDisposalReport } from '$lib/runtime/resource-scope';
import { loggingSettings } from '$lib/stores/logging-settings';
import { installLoggingRuntime } from './api';
import type { LoggingConsole, LoggingSettings } from './contracts';
import { createLoggingRuntime, type LoggingRuntime } from './runtime';

const BENIGN_GLOBAL_ERROR_MESSAGES = new Set([
  'ResizeObserver loop completed with undelivered notifications.',
  'ResizeObserver loop limit exceeded'
]);

export interface LoggingPageTarget extends EventTarget {
  readonly console?: LoggingConsole;
  readonly navigator?: Pick<Navigator, 'platform'>;
}

export interface InitializeLoggingOptions {
  readonly runtime: Pick<PageRuntime, 'broadcastChannels' | 'clock' | 'ids' | 'scope'>;
  readonly context: string;
  readonly target?: LoggingPageTarget;
  readonly version?: string;
  readonly settings?: () => LoggingSettings;
}

export interface InitializedLogging {
  readonly runtime: LoggingRuntime;
  destroy(): Promise<ScopeDisposalReport>;
}

const activePages = new WeakMap<ResourceScope, InitializedLogging>();

function eventProperty(event: Event, key: string): unknown {
  try { return (event as unknown as Record<string, unknown>)[key]; } catch { return undefined; }
}

export function initializeLogging(options: InitializeLoggingOptions): InitializedLogging {
  const existing = activePages.get(options.runtime.scope);
  if (existing) return existing;

  const scope = new ResourceScope(`${options.context} logging`, options.runtime.clock, options.runtime.ids);
  const logging = createLoggingRuntime({
    context: options.context,
    scope,
    clock: options.runtime.clock,
    ids: options.runtime.ids,
    channels: { create: (name) => options.runtime.broadcastChannels.create(name) },
    settings: options.settings ?? (() => loggingSettings.getSnapshot()),
    console: options.target?.console
  });
  const uninstall = installLoggingRuntime(logging);
  let destroyPromise: Promise<ScopeDisposalReport> | undefined;
  let parentRegistration: ReturnType<ResourceScope['register']>;

  const destroy = (): Promise<ScopeDisposalReport> => {
    if (destroyPromise) return destroyPromise;
    uninstall();
    activePages.delete(options.runtime.scope);
    destroyPromise = logging.destroy().then((report) => {
      parentRegistration.complete();
      return report;
    });
    return destroyPromise;
  };

  const initialized: InitializedLogging = { runtime: logging, destroy };
  parentRegistration = options.runtime.scope.register(
    { kind: 'child-scope', label: `${options.context} logging` },
    async () => { await destroy(); }
  );
  activePages.set(options.runtime.scope, initialized);

  logging.init();

  if (options.target) {
    const errorListener: EventListener = (event) => {
      const message = eventProperty(event, 'message');
      if (typeof message === 'string' && BENIGN_GLOBAL_ERROR_MESSAGES.has(message)) return;
      logging.log('error', 'system', 'Uncaught error', {
        message,
        file: eventProperty(event, 'filename'),
        line: eventProperty(event, 'lineno'),
        column: eventProperty(event, 'colno'),
        error: eventProperty(event, 'error')
      });
    };
    const rejectionListener: EventListener = (event) => {
      logging.log('error', 'system', 'Unhandled promise rejection', eventProperty(event, 'reason'));
    };
    const attach = (type: string, listener: EventListener, label: string): void => {
      try {
        options.target?.addEventListener(type, listener);
        try {
          scope.register(
            { kind: 'event-listener', label },
            () => options.target?.removeEventListener(type, listener)
          );
        } catch {
          options.target?.removeEventListener(type, listener);
        }
      } catch {
        // Global failure capture is optional; local logging remains available.
      }
    };
    attach('error', errorListener, `${options.context} global errors`);
    attach('unhandledrejection', rejectionListener, `${options.context} unhandled rejections`);
  }

  logging.log('info', 'system', `${options.context} context started`, {
    version: options.version ?? appVersion,
    platform: options.target?.navigator?.platform
  });

  return initialized;
}
