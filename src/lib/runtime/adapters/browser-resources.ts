import { DomainError, toDomainError } from '../errors';
import type { AbortControllerPort, BroadcastChannelPort, ObjectUrlPort } from '../ports';

export interface BrowserResourceTarget {
  readonly AbortController?: typeof AbortController;
  readonly BroadcastChannel?: typeof BroadcastChannel;
  readonly URL?: typeof URL;
}

function unavailable(operation: string, code: string): DomainError {
  return new DomainError({ category: 'unavailable', code, operation, retryable: false });
}

export class BrowserAbortControllers implements AbortControllerPort {
  constructor(private readonly target: BrowserResourceTarget) {}

  create(): AbortController {
    if (!this.target.AbortController) {
      throw unavailable('create abort controller', 'runtime.abort-controller-unavailable');
    }
    return new this.target.AbortController();
  }
}

export class BrowserBroadcastChannels implements BroadcastChannelPort {
  constructor(private readonly target: BrowserResourceTarget) {}

  create(name: string): BroadcastChannel {
    if (!this.target.BroadcastChannel) {
      throw unavailable('create broadcast channel', 'runtime.broadcast-channel-unavailable');
    }
    try {
      return new this.target.BroadcastChannel(name);
    } catch (cause) {
      throw toDomainError(cause, 'create broadcast channel', 'runtime.broadcast-channel-create-failed');
    }
  }
}

export class BrowserObjectUrls implements ObjectUrlPort {
  constructor(private readonly target: BrowserResourceTarget) {}

  create(blob: Blob): string {
    if (!this.target.URL?.createObjectURL) {
      throw unavailable('create object URL', 'runtime.object-url-unavailable');
    }
    try {
      return this.target.URL.createObjectURL(blob);
    } catch (cause) {
      throw toDomainError(cause, 'create object URL', 'runtime.object-url-create-failed');
    }
  }

  revoke(url: string): void {
    if (!this.target.URL?.revokeObjectURL) return;
    this.target.URL.revokeObjectURL(url);
  }
}
