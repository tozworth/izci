import { toDomainError } from '../errors';
import type { ViteWorkerConstructor, WorkerPort } from '../ports';

export class BrowserWorkerPort implements WorkerPort {
  create<TWorker extends Worker>(constructor: ViteWorkerConstructor<TWorker>): TWorker {
    try {
      return new constructor();
    } catch (cause) {
      throw toDomainError(cause, 'create worker', 'runtime.worker-create-failed');
    }
  }
}
