import { writable } from 'svelte/store';

interface VisualizerSource {
  analyser: AnalyserNode;
  context: BaseAudioContext;
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

  function clear(): void {
    source.set(null);
  }

  return {
    source,
    setAnalyser(analyser: AnalyserNode): void {
      source.set({ analyser: configureAnalyser(analyser), context: analyser.context });
    },
    clear
  };
}

export const visualizerService = createVisualizerService();
