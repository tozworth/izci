import { invoke } from '@tauri-apps/api/core';
import { emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { BUBBLE_DISMISS_EVENT, BUBBLE_DURATION_MS, BUBBLE_FADE_MS, BUBBLE_READY_EVENT, BUBBLE_REQUEST_EVENT, BUBBLE_STATE_EVENT, BUBBLE_VOLUME_EVENT, VOLUME_BUBBLE_DURATION_MS, type TrayBubbleContent, type TrackBubbleUpdate, type VolumeBubble } from './tray-bubble-protocol';

export function createTrayBubblePresenter(
  render: (content: TrayBubbleContent | null, visible: boolean) => void,
  measure: () => Promise<{ width: number; height: number }>,
): () => void {
  let disposed = false;
  let revision = 0;
  let content: TrayBubbleContent | null = null;
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
    content = null;
    visible = false;
    presented = false;
    render(null, false);
    enqueue(() => invoke('hide_desktop_track_bubble'));
  }
  function update(payload: TrackBubbleUpdate): void {
    if (disposed) return;
    // Keep wheel feedback visible while playback/metadata notifications arrive.
    if (content && 'percent' in content) return;
    if (!payload.track) { dismiss(); return; }
    if (!payload.announce) {
      if (content && 'id' in content && content.id === payload.track.id) {
        content = payload.track;
        render(content, visible);
        const current = revision;
        if (presented) enqueue(async () => {
          const size = await measure();
          if (disposed || revision !== current || !presented) return;
          if (!await invoke<boolean>('show_desktop_track_bubble', size)) dismiss();
        });
      }
      return;
    }
    present(payload.track, BUBBLE_DURATION_MS);
  }
  function present(next: TrayBubbleContent, duration: number): void {
    const volume = 'percent' in next;
    const keepVisible = volume && content && 'percent' in content && visible && presented;
    const current = ++revision;
    clearTimers();
    content = next;
    visible = Boolean(keepVisible);
    presented = Boolean(keepVisible);
    render(content, visible);
    enqueue(async () => {
      if (disposed || revision !== current) return;
      if (!keepVisible) await invoke('hide_desktop_track_bubble');
      const size = await measure();
      if (disposed || revision !== current) return;
      const shown = await invoke<boolean>('show_desktop_track_bubble', volume ? { ...size, volume: true } : size);
      if (disposed || revision !== current) return;
      if (!shown) { if (volume) dismiss(); return; }
      presented = true;
      // Let WebView2 paint the transparent first frame before fading in.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (disposed || revision !== current) return;
        visible = true;
        render(content, true);
      }));
      later(() => { visible = false; render(content, false); }, duration - BUBBLE_FADE_MS);
      later(dismiss, duration);
    });
  }
  void Promise.all([
    listen<TrackBubbleUpdate>(BUBBLE_STATE_EVENT, ({ payload }) => update(payload)),
    listen<VolumeBubble>(BUBBLE_VOLUME_EVENT, ({ payload }) => {
      if (!disposed && Number.isFinite(payload?.percent) && payload.percent >= 0 && payload.percent <= 100) {
        present({ percent: Math.round(payload.percent) }, VOLUME_BUBBLE_DURATION_MS);
      }
    }),
    listen(BUBBLE_DISMISS_EVENT, dismiss),
    listen(BUBBLE_REQUEST_EVENT, () => { if (!disposed) void emitTo('main', BUBBLE_READY_EVENT).catch(console.error); }),
  ].map((registration) => registration.then((release) => {
    if (disposed) release(); else releases.push(release);
  }))).then(() => { if (!disposed) return emitTo('main', BUBBLE_READY_EVENT); }).catch(console.error);
  return () => { disposed = true; dismiss(); releases.forEach((release) => release()); };
}
