import type {
  AbortControllerPort,
  BroadcastChannelPort,
  ClockPort,
  ObjectUrlPort,
  WorkerPort,
  ViteWorkerConstructor
} from './ports';
import { ResourceScope, type OwnedResource, type ResourceRegistration } from './resource-scope';

interface EventTargetPort {
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void;
}

export function ownEventListener(
  scope: ResourceScope,
  target: EventTargetPort,
  type: string,
  listener: EventListenerOrEventListenerObject,
  options: boolean | AddEventListenerOptions | undefined,
  label: string
): ResourceRegistration {
  target.addEventListener(type, listener, options);
  try {
    return scope.register(
      { kind: 'event-listener', label },
      () => target.removeEventListener(type, listener, typeof options === 'object' ? options.capture : options)
    );
  } catch (error) {
    target.removeEventListener(type, listener, typeof options === 'object' ? options.capture : options);
    throw error;
  }
}

export function ownTimeout(
  scope: ResourceScope,
  clock: ClockPort,
  callback: () => void,
  delayMs: number,
  label: string
): ResourceRegistration {
  let registration: ResourceRegistration;
  const handle = clock.setTimeout(() => {
    try { callback(); } finally { registration.complete(); }
  }, delayMs);
  try {
    registration = scope.register({ kind: 'timeout', label }, () => clock.clearTimeout(handle));
    return registration;
  } catch (error) {
    clock.clearTimeout(handle);
    throw error;
  }
}

export function ownInterval(
  scope: ResourceScope,
  clock: ClockPort,
  callback: () => void,
  delayMs: number,
  label: string
): ResourceRegistration {
  const handle = clock.setInterval(callback, delayMs);
  try {
    return scope.register({ kind: 'interval', label }, () => clock.clearInterval(handle));
  } catch (error) {
    clock.clearInterval(handle);
    throw error;
  }
}

export function ownAnimationFrame(
  scope: ResourceScope,
  clock: ClockPort,
  callback: (time: number) => void,
  label: string
): ResourceRegistration {
  let registration: ResourceRegistration;
  const handle = clock.requestAnimationFrame((time) => {
    try { callback(time); } finally { registration.complete(); }
  });
  try {
    registration = scope.register(
      { kind: 'animation-frame', label },
      () => clock.cancelAnimationFrame(handle)
    );
    return registration;
  } catch (error) {
    clock.cancelAnimationFrame(handle);
    throw error;
  }
}

export function ownAbortController(
  scope: ResourceScope,
  controllers: AbortControllerPort,
  label: string
): OwnedResource<AbortController> {
  const controller = controllers.create();
  try {
    return scope.own({ kind: 'abort-controller', label }, controller, (owned) => owned.abort());
  } catch (error) {
    controller.abort();
    throw error;
  }
}

export function ownBroadcastChannel(
  scope: ResourceScope,
  channels: BroadcastChannelPort,
  name: string,
  label: string
): OwnedResource<BroadcastChannel> {
  const channel = channels.create(name);
  try {
    return scope.own({ kind: 'broadcast-channel', label }, channel, (owned) => owned.close());
  } catch (error) {
    channel.close();
    throw error;
  }
}

export function ownWorker<TWorker extends Worker>(
  scope: ResourceScope,
  workers: WorkerPort,
  constructor: ViteWorkerConstructor<TWorker>,
  label: string
): OwnedResource<TWorker> {
  const worker = workers.create(constructor);
  try {
    return scope.own({ kind: 'worker', label }, worker, (owned) => owned.terminate());
  } catch (error) {
    worker.terminate();
    throw error;
  }
}

export function ownObjectUrl(
  scope: ResourceScope,
  objectUrls: ObjectUrlPort,
  blob: Blob,
  label: string
): OwnedResource<string> {
  const url = objectUrls.create(blob);
  try {
    return scope.own({ kind: 'object-url', label }, url, (owned) => objectUrls.revoke(owned));
  } catch (error) {
    objectUrls.revoke(url);
    throw error;
  }
}
