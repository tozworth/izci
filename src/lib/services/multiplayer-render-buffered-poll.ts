import { multiplayerRenderPlaybackService } from '$lib/services/multiplayer-render-playback';

const RENDER_BUFFERED_POLL_INTERVAL_MS = 500;

/**
 * Polls the render-playback service for buffered ranges while the main window
 * is a render-delivery freeplay client, so the seek bar can show the render
 * pipeline's buffered progress. Pushes changes out through the onChange
 * callback; the component owns the reactive lets.
 */
export function createRenderBufferedPollController(
  onChange: (ranges: Array<[number, number]> | null, buffering: boolean) => void
) {
  let timer: number | null = null;
  let ranges: Array<[number, number]> | null = null;
  let buffering = false;

  function sameBufferedRanges(a: Array<[number, number]> | null, b: Array<[number, number]>): boolean {
    if (a === null) return b.length === 0;
    if (a.length !== b.length) return false;
    return a.every(([start, end], index) => start === b[index][0] && end === b[index][1]);
  }

  function start(): void {
    if (timer !== null || typeof window === 'undefined') return;
    timer = window.setInterval(() => {
      const state = multiplayerRenderPlaybackService.getState();
      const nextRanges = state.bufferedRanges
        .map(([start, end]): [number, number] => [start / 1_000, end / 1_000]);
      if (!sameBufferedRanges(ranges, nextRanges)) {
        ranges = nextRanges;
        onChange(ranges, buffering);
      }
      if (buffering !== state.buffering) {
        buffering = state.buffering;
        onChange(ranges, buffering);
      }
    }, RENDER_BUFFERED_POLL_INTERVAL_MS);
  }

  function stop(): void {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
    ranges = null;
    buffering = false;
    onChange(null, false);
  }

  return { start, stop };
}
