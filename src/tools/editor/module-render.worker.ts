import { renderModulePcm, type ModuleRenderRequest } from '$lib/services/module-render-core';

interface ModuleRenderWorkerScope {
  onmessage: ((event: MessageEvent<ModuleRenderRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const worker = self as unknown as ModuleRenderWorkerScope;

function postProgress(renderedFrames: number, totalFrames: number): void {
  worker.postMessage({
    type: 'progress',
    progress: totalFrames > 0 ? Math.min(renderedFrames / totalFrames, 1) : null,
    renderedFrames,
    totalFrames
  });
}

worker.onmessage = (event: MessageEvent<ModuleRenderRequest>) => {
  if (event.data?.type !== 'render') return;
  const request = event.data;
  void renderModulePcm(request, (progress) => {
    postProgress(progress.renderedFrames, progress.totalFrames);
  })
    .then(([left, right]) => {
      worker.postMessage(
        { type: 'complete', sampleRate: request.sampleRate, left: left.buffer, right: right.buffer },
        [left.buffer, right.buffer]
      );
    })
    .catch((error) => {
      worker.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : 'Module rendering failed.'
      });
    });
};
