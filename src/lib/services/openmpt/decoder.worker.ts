import { initializeOpenMpt } from './runtime';
import { OpenMptModule } from './module';
import type { ModuleDecodeRequest, ModuleDecodeResponse } from './protocol';

const worker = self as unknown as DedicatedWorkerGlobalScope;
// Creation/inspection is synchronous after initialization. Serialize messages so
// a bulk import has one live module and one shared heap, with no audio graph.
let jobs = Promise.resolve();
worker.onmessage = (event: MessageEvent<ModuleDecodeRequest>) => {
  const request = event.data;
  jobs = jobs.then(async () => {
    let module: OpenMptModule | undefined;
    let response: ModuleDecodeResponse;
    try {
      module = new OpenMptModule(await initializeOpenMpt(), request.buffer, request.subsong);
      response = {
        id: request.id, accepted: true,
        ...(request.mode === 'verify' ? {} : { inspection: module.inspect(request.mode === 'patterns') })
      };
    } catch (error) {
      response = { id: request.id, error: error instanceof Error ? error.message : 'Module inspection failed.' };
    } finally {
      module?.dispose();
    }
    worker.postMessage(response);
  });
};
