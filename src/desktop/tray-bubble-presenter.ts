import { invoke } from '@tauri-apps/api/core';
import { emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { BUBBLE_DISMISS_EVENT, BUBBLE_DURATION_MS, BUBBLE_FADE_MS, BUBBLE_READY_EVENT, BUBBLE_REQUEST_EVENT, BUBBLE_STATE_EVENT, type TrackBubble, type TrackBubbleUpdate } from './tray-bubble-protocol';

export function createTrayBubblePresenter(
  render: (track: TrackBubble | null, visible: boolean) => void,
  measure: () => Promise<{ width: number; height: number }>,
): () => void {
  let disposed = false;
  let revision = 0;
  let track: TrackBubble | null = null;
  let visible = false;
  let presented = false;
  let work: Promise<unknown> = Promise.resolve();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const releases: UnlistenFn[] = [];

  function enqueue(action: () => Promise<unknown>): void {
    work = work.then(action).catch((error) => console.error('Could not present track info bubble.', error));
  }
  function clearTimers(): void { timers.forEach(clearTimeout); timers.clear(); }
  function later(action: () => void, delay: number): void {
    const timer = setTimeout(() => { timers.delete(timer); action(); }, delay);
    timers.add(timer);
  }
  function dismiss(): void {
    ++revision;
    clearTimers();
    track = null;
    visible = false;
    presented = false;
    render(null, false);
    enqueue(() => invoke('hide_desktop_track_bubble'));
  }
  function update(payload: TrackBubbleUpdate): void {
    if (disposed) return;
    if (!payload.track) { dismiss(); return; }
    if (!payload.announce) {
      if (track?.id === payload.track.id) {
        track = payload.track;
        render(track, visible);
        const current = revision;
        if (presented) enqueue(async () => {
          const size = await measure();
          if (disposed || revision !== current || !presented) return;
          if (!await invoke<boolean>('show_desktop_track_bubble', size)) dismiss();
        });
      }
      return;
    }
    const current = ++revision;
    clearTimers();
    track = payload.track;
    visible = false;
    presented = false;
    render(track, false);
    enqueue(async () => {
      if (disposed || revision !== current) return;
      await invoke('hide_desktop_track_bubble');
      const size = await measure();
      if (disposed || revision !== current) return;
      const shown = await invoke<boolean>('show_desktop_track_bubble', size);
      if (disposed || revision !== current || !shown) return;
      presented = true;
      // Let WebView2 paint the transparent first frame before fading in.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (disposed || revision !== current) return;
        visible = true;
        render(track, true);
      }));
      later(() => { visible = false; render(track, false); }, BUBBLE_DURATION_MS - BUBBLE_FADE_MS);
      later(dismiss, BUBBLE_DURATION_MS);
    });
  }
  void Promise.all([
    listen<TrackBubbleUpdate>(BUBBLE_STATE_EVENT, ({ payload }) => update(payload)),
    listen(BUBBLE_DISMISS_EVENT, dismiss),
    listen(BUBBLE_REQUEST_EVENT, () => { if (!disposed) void emitTo('main', BUBBLE_READY_EVENT).catch(console.error); }),
  ].map((registration) => registration.then((release) => {
    if (disposed) release(); else releases.push(release);
  }))).then(() => { if (!disposed) return emitTo('main', BUBBLE_READY_EVENT); }).catch(console.error);
  return () => { disposed = true; dismiss(); releases.forEach((release) => release()); };
}
