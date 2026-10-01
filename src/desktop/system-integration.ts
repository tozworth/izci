import { invoke } from '@tauri-apps/api/core';
import { emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { get } from 'svelte/store';
import type { PlatformIntegrationOptions } from '$lib/services/platform-integration-types';
import { desktopSettings, type DesktopShowIn } from './settings';
import { readDesktopFiles } from './files';
import { createTrackBubblePublisher } from './track-bubble-publisher';
import { parseTrayAction, trayState, TRAY_ACTION_EVENT, TRAY_REQUEST_EVENT, TRAY_STATE_EVENT, type TrayState } from './tray-protocol';

function reportError(error: unknown): void { console.error('Desktop integration failed.', error); }
export function openDesktopDefaultApps(): void { void invoke('open_desktop_default_apps').catch(reportError); }

export function createPlatformIntegration(options: PlatformIntegrationOptions): () => void {
  let disposed = false;
  let previousShowIn: DesktopShowIn | undefined;
  let previousAssociations: boolean | undefined;
  let previousFocusOnFileLaunch: boolean | undefined;
  let settingsWork: Promise<unknown> = Promise.resolve();
  let importWork: Promise<unknown> = Promise.resolve();
  let launchTimer: ReturnType<typeof setTimeout> | undefined;
  const releases: UnlistenFn[] = [];
  let lastTrayState: TrayState | undefined;

  async function publish(force = false): Promise<void> {
    if (!disposed && desktopSettings.getSnapshot().showIn !== 'taskbar') {
      const snapshot = get(options.snapshot);
      const state = trayState(snapshot, options.canControl() || snapshot.backend !== null);
      if (!force && state.playing === lastTrayState?.playing && state.canControl === lastTrayState?.canControl) return;
      lastTrayState = state;
      await emitTo('tray-menu', TRAY_STATE_EVENT, state);
    }
  }
  async function drainFiles(): Promise<void> {
    if (disposed) return;
    const paths = await invoke<string[]>('take_desktop_launch_paths');
    if (paths.length) await options.importFiles(await readDesktopFiles(paths));
  }
  function scheduleFiles(): void {
    if (launchTimer !== undefined) clearTimeout(launchTimer);
    launchTimer = setTimeout(() => {
      launchTimer = undefined;
      importWork = importWork.then(drainFiles).catch(reportError);
    }, 75);
  }
  const unsubscribeSettings = desktopSettings.subscribe((settings) => {
    settingsWork = settingsWork.then(async () => {
      if (disposed) return;
      if (settings.focusOnFileLaunch !== previousFocusOnFileLaunch) {
        await invoke('configure_desktop_file_launch', { focus: settings.focusOnFileLaunch });
        previousFocusOnFileLaunch = settings.focusOnFileLaunch;
      }
      if (settings.showIn !== previousShowIn) {
        await invoke('configure_desktop_visibility', { showIn: settings.showIn });
        previousShowIn = settings.showIn;
      }
      if (settings.fileAssociations !== previousAssociations) {
        await invoke('configure_desktop_associations', { enabled: settings.fileAssociations });
        previousAssociations = settings.fileAssociations;
      }
    }).catch(reportError);
  });
  const unsubscribeSnapshot = options.snapshot.subscribe(() => { void publish().catch(reportError); });
  const stopTrackBubble = createTrackBubblePublisher(options, () => settingsWork);
  void Promise.all([
    listen(TRAY_REQUEST_EVENT, () => { void publish(true).catch(reportError); }),
    listen<unknown>(TRAY_ACTION_EVENT, ({ payload }) => {
      if (disposed) return;
      const action = parseTrayAction(payload);
      if (!action) return;
      if (action === 'open' || action === 'enterOda') {
        void invoke('restore_main_window')
          .then(() => { if (!disposed && action === 'enterOda') options.handlers.enterOda(); })
          .catch(reportError);
      }
      else options.handlers[action]();
    }),
    listen('izci:desktop-files-available', scheduleFiles)
  ].map((registration) => registration.then((release) => {
    if (disposed) release(); else releases.push(release);
  }))).then(() => { if (!disposed) scheduleFiles(); }).catch(reportError);

  return () => {
    disposed = true;
    if (launchTimer !== undefined) clearTimeout(launchTimer);
    unsubscribeSettings(); unsubscribeSnapshot(); releases.forEach((release) => release());
    stopTrackBubble();
  };
}
