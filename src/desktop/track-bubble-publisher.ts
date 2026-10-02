import { emitTo, listen } from '@tauri-apps/api/event';
import { get } from 'svelte/store';
import type { PlatformIntegrationOptions } from '$lib/services/platform-integration-types';
import { getTrackDisplayTitle } from '$lib/utils/files';
import { desktopSettings } from './settings';
import { BUBBLE_READY_EVENT, BUBBLE_REQUEST_EVENT, BUBBLE_STATE_EVENT, type TrackBubble, type TrackBubbleUpdate } from './tray-bubble-protocol';

export function createTrackBubblePublisher(options: Pick<PlatformIntegrationOptions, 'track' | 'snapshot' | 'playbackStarts'>, waitForSettings: () => Promise<unknown>): () => void {
  let disposed = false;
  let ready = false;
  let scheduled = false;
  let lastTrack: TrackBubble | null = null;
  let playing = false;
  let playbackStarted = false;
  let unlisten: (() => void) | undefined;

  async function publish(): Promise<void> {
    await waitForSettings();
    scheduled = false;
    if (disposed || !ready) return;
    const settings = desktopSettings.getSnapshot();
    const track = get(options.track);
    const snapshot = get(options.snapshot);
    const announce = playbackStarted && snapshot.state === 'playing';
    playbackStarted = false;
    if (settings.showIn === 'taskbar' || !settings.trackInfoBubble || !track || snapshot.backend === null) {
      if (lastTrack) {
        lastTrack = null;
        await emitTo('tray-bubble', BUBBLE_STATE_EVENT, { track: null, announce: false } satisfies TrackBubbleUpdate);
      }
      // Enabling the feature should wait for the next playback start.
      return;
    }
    const next: TrackBubble = { id: track.id, title: getTrackDisplayTitle(track) || track.name, artist: track.metadata?.artist?.trim() ?? '' };
    if (!announce && (!lastTrack || (next.id === lastTrack.id && next.title === lastTrack.title && next.artist === lastTrack.artist))) return;
    lastTrack = next;
    await emitTo('tray-bubble', BUBBLE_STATE_EVENT, { track: next, announce } satisfies TrackBubbleUpdate);
  }

  function schedule(): void {
    if (scheduled || disposed) return;
    scheduled = true;
    void publish().catch((error) => { scheduled = false; console.error('Could not update track info bubble.', error); });
  }
  const releases = [options.track.subscribe(schedule), options.snapshot.subscribe((snapshot) => {
    const nextPlaying = snapshot.state === 'playing' && snapshot.backend !== null;
    if (nextPlaying && !playing) playbackStarted = true;
    playing = nextPlaying;
    schedule();
  }), desktopSettings.subscribe(schedule)];
  let startSequence = options.playbackStarts ? get(options.playbackStarts) : 0;
  if (options.playbackStarts) releases.push(options.playbackStarts.subscribe((sequence) => {
    if (sequence === startSequence) return;
    startSequence = sequence;
    playbackStarted = true;
    schedule();
  }));
  void listen(BUBBLE_READY_EVENT, () => { ready = true; schedule(); }).then((release) => {
    if (disposed) release(); else { unlisten = release; return emitTo('tray-bubble', BUBBLE_REQUEST_EVENT); }
  }).catch(console.error);
  return () => { disposed = true; releases.forEach((release) => release()); unlisten?.(); };
}
