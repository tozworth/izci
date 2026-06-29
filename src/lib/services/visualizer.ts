import { writable } from 'svelte/store';

type VisualizerConnectionKind = 'stream' | 'module';

interface VisualizerSource {
  analyser: AnalyserNode;
  context: BaseAudioContext;
  kind: VisualizerConnectionKind;
}

type HtmlMediaElementWithCaptureStream = HTMLMediaElement & {
  captureStream?: () => MediaStream;
  mozCaptureStream?: () => MediaStream;
};

function createAudioContext(): AudioContext | null {
  const AudioContextConstructor =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return AudioContextConstructor ? new AudioContextConstructor() : null;
}

function resumeContext(context: BaseAudioContext): void {
  if ('resume' in context && typeof context.resume === 'function') {
    void context.resume().catch(() => undefined);
  }
}

function configureAnalyser(analyser: AnalyserNode): AnalyserNode {
  analyser.fftSize = 1024;
  analyser.minDecibels = -88;
  analyser.maxDecibels = -18;
  analyser.smoothingTimeConstant = 0.82;
  return analyser;
}

function createVisualizerService() {
  const source = writable<VisualizerSource | null>(null);
  let cleanup: (() => void) | null = null;

  function clear(): void {
    cleanup?.();
    cleanup = null;
    source.set(null);
  }

  return {
    source,
    connectHtmlMediaElement(element: HTMLMediaElement | null): void {
      clear();

      if (!element || typeof window === 'undefined') {
        return;
      }

      const captureStream =
        (element as HtmlMediaElementWithCaptureStream).captureStream ??
        (element as HtmlMediaElementWithCaptureStream).mozCaptureStream;

      if (!captureStream) {
        return;
      }

      const context = createAudioContext();

      if (!context) {
        return;
      }

      let mediaStream: MediaStream | null = null;

      try {
        mediaStream = captureStream.call(element);
        const mediaSource = context.createMediaStreamSource(mediaStream);
        const analyser = configureAnalyser(context.createAnalyser());

        mediaSource.connect(analyser);
        resumeContext(context);

        cleanup = () => {
          try {
            mediaSource.disconnect();
          } catch {
            // The stream source may already be gone when Howler unloads the media element.
          }

          mediaStream?.getTracks().forEach((track) => track.stop());
          void context.close().catch(() => undefined);
        };

        source.set({ analyser, context, kind: 'stream' });
      } catch {
        mediaStream?.getTracks().forEach((track) => track.stop());
        void context.close().catch(() => undefined);
      }
    },
    connectAudioNode(node: AudioNode | null): void {
      clear();

      if (!node) {
        return;
      }

      try {
        const analyser = configureAnalyser(node.context.createAnalyser());
        node.connect(analyser);
        resumeContext(node.context);

        cleanup = () => {
          try {
            node.disconnect(analyser);
          } catch {
            // The module player owns this node and may disconnect it first during teardown.
          }
        };

        source.set({ analyser, context: node.context, kind: 'module' });
      } catch {
        source.set(null);
      }
    },
    clear
  };
}

export const visualizerService = createVisualizerService();
