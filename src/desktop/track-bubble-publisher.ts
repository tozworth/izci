import { emitTo, listen } from '@tauri-apps/api/event';
import { get } from 'svelte/store';
import type { PlatformIntegrationOptions } from '$lib/services/platform-integration-types';
import { getTrackDisplayTitle } from '$lib/utils/files';
import { desktopSettings } from './settings';
import { BUBBLE_READY_EVENT, BUBBLE_REQUEST_EVENT, BUBBLE_STATE_EVENT, type TrackBubble, type TrackBubbleUpdate } from './tray-bubble-protocol';

export function createTrackBubblePublisher(options: Pick<PlatformIntegrationOptions, 'track' | 'snapshot'>, waitForSettings: () => Promise<unknown>): () => void {
  let disposed = false;
  let ready = false;
  let scheduled = false;
  let lastTrack: TrackBubble | null = null;
  let lastPlayedId: string | null = null;
  let unlisten: (() => void) | undefined;

  async function publish(): Promise<void> {
    await waitForSettings();
    scheduled = false;
    if (disposed || !ready) return;
    const settings = desktopSettings.getSnapshot();
    const track = get(options.track);
    const snapshot = get(options.snapshot);
    if (!track || snapshot.backend === null) lastPlayedId = null;
    if (settings.showIn === 'taskbar' || !settings.trackInfoBubble || !track || snapshot.backend === null) {
      if (lastTrack) {
        lastTrack = null;
        await emitTo('tray-bubble', BUBBLE_STATE_EVENT, { track: null, announce: false } satisfies TrackBubbleUpdate);
      }
      // Enabling the feature should wait for the next track change.
      if (track && snapshot.backend !== null && snapshot.state === 'playing') lastPlayedId = track.id;
      return;
    }
    const next: TrackBubble = { id: track.id, title: getTrackDisplayTitle(track) || track.name, artist: track.metadata?.artist?.trim() ?? '' };
    const announce = snapshot.state === 'playing' && track.id !== lastPlayedId;
    if (!announce && (!lastTrack || (next.id === lastTrack.id && next.title === lastTrack.title && next.artist === lastTrack.artist))) return;
    if (announce) lastPlayedId = track.id;
    lastTrack = next;
    await emitTo('tray-bubble', BUBBLE_STATE_EVENT, { track: next, announce } satisfies TrackBubbleUpdate);
  }

  function schedule(): void {
    if (scheduled || disposed) return;
    scheduled = true;
    void publish().catch((error) => { scheduled = false; console.error('Could not update track info bubble.', error); });
  }
  const releases = [options.track.subscribe(schedule), options.snapshot.subscribe(schedule), desktopSettings.subscribe(schedule)];
  void listen(BUBBLE_READY_EVENT, () => { ready = true; schedule(); }).then((release) => {
    if (disposed) release(); else { unlisten = release; return emitTo('tray-bubble', BUBBLE_REQUEST_EVENT); }
  }).catch(console.error);
  return () => { disposed = true; releases.forEach((release) => release()); unlisten?.(); };
}
