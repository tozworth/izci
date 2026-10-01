import { documentSegmentAt, type AudioDocument } from './audio-document';

interface PreviewCallbacks {
  position(position: number): void;
  playing(playing: boolean): void;
}

/** Schedule referenced source slices on one audio clock, including across edit joins. */
export function createEditorPreview(callbacks: PreviewCallbacks) {
  let context: AudioContext | null = null;
  let sources = new Set<AudioBufferSourceNode>();
  let generation = 0;
  let frame = 0;
  let timer = 0;
  let startedAt = 0;
  let offset = 0;
  let end = 0;
  let playing = false;
  let lastPublished = 0;
  let fillSchedule: (() => void) | null = null;

  const visibilityChanged = () => fillSchedule?.();
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', visibilityChanged);

  function position(): number {
    return playing && context ? Math.min(end, offset + Math.max(0, context.currentTime - startedAt)) : offset;
  }

  function stop(): void {
    generation += 1;
    offset = position();
    playing = false;
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    fillSchedule = null;
    for (const source of sources) {
      source.onended = null;
      source.stop();
      source.disconnect();
    }
    sources.clear();
    callbacks.position(offset);
    callbacks.playing(false);
  }

  function tick(now: number): void {
    if (!playing) return;
    // Publish UI clock text at 30 Hz; the renderer reads this clock at display rate.
    if (now - lastPublished >= 1000 / 30) {
      lastPublished = now;
      callbacks.position(position());
    }
    if (position() >= end) { stop(); return; }
    frame = requestAnimationFrame(tick);
  }

  async function start(document: AudioDocument, start: number, finish: number): Promise<void> {
    stop();
    const run = generation;
    context ??= new AudioContext();
    const audioContext = context;
    await audioContext.resume();
    if (run !== generation) return;
    offset = Math.max(0, Math.min(start, document.duration));
    end = Math.max(offset, Math.min(finish, document.duration));
    if (end <= offset) return;
    startedAt = audioContext.currentTime + 0.015;
    playing = true;
    lastPublished = 0;
    const firstFrame = Math.round(offset * document.sampleRate);
    const lastFrame = Math.round(end * document.sampleRate);
    let index = documentSegmentAt(document, firstFrame);

    function schedule(): void {
      if (!playing || run !== generation) return;
      clearTimeout(timer);
      // Bound scheduled nodes even after hundreds of tiny edits. The audio clock,
      // rather than onended or UI frame timing, determines every join.
      // Hidden windows can throttle timers for minutes; schedule the remaining
      // referenced slices before that happens to preserve background playback.
      const horizon = typeof globalThis.document !== 'undefined' && globalThis.document.hidden
        ? Infinity : audioContext.currentTime + 2;
      while (index < document.segments.length && document.offsets[index] < lastFrame) {
        const segment = document.segments[index];
        const logicalStart = Math.max(firstFrame, document.offsets[index],
          firstFrame + Math.floor(Math.max(0, audioContext.currentTime - startedAt) * document.sampleRate));
        const logicalEnd = Math.min(lastFrame, document.offsets[index] + segment.end - segment.start);
        if (logicalEnd <= logicalStart) { index += 1; continue; }
        const when = startedAt + (logicalStart - firstFrame) / document.sampleRate;
        if (when > horizon) break;
        const source = audioContext.createBufferSource();
        source.buffer = segment.buffer;
        source.connect(audioContext.destination);
        sources.add(source);
        source.onended = () => {
          sources.delete(source);
          source.disconnect();
          if (run === generation && logicalEnd === lastFrame) stop();
        };
        source.start(when, (segment.start + logicalStart - document.offsets[index]) / document.sampleRate,
          (logicalEnd - logicalStart) / document.sampleRate);
        index += 1;
      }
      // A short selection may end in the middle of the document.
      if (position() >= end) { stop(); return; }
      timer = window.setTimeout(schedule, 50);
    }

    callbacks.position(offset);
    callbacks.playing(true);
    fillSchedule = schedule;
    schedule();
    frame = requestAnimationFrame(tick);
  }

  return {
    start, stop, position,
    destroy() {
      stop();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', visibilityChanged);
      void context?.close();
      context = null;
    }
  };
}
