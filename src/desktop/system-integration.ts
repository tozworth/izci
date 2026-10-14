import { invoke } from '@tauri-apps/api/core';
import { emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { get } from 'svelte/store';
import type { PlatformIntegrationOptions } from '$lib/services/platform-integration-types';
import { desktopSettings, type DesktopShowIn, type DesktopTrayIcon } from './settings';
import { readDesktopFiles } from './files';
import { createTrackBubblePublisher } from './track-bubble-publisher';
import { parseTrayAction, trayState, TRAY_ACTION_EVENT, TRAY_REQUEST_EVENT, TRAY_STATE_EVENT, TRAY_VOLUME_STEP_EVENT, TRAY_VOLUME_STEP, type TrayState } from './tray-protocol';
import { BUBBLE_VOLUME_EVENT, type VolumeBubble } from './tray-bubble-protocol';
import { isRafMenuAction, runRafMenuAction } from '$lib/services/raf-menu';

function reportError(error: unknown): void { console.error('Desktop integration failed.', error); }
export function openDesktopDefaultApps(): void { void invoke('open_desktop_default_apps').catch(reportError); }

export function createPlatformIntegration(options: PlatformIntegrationOptions): () => void {
  let disposed = false;
  let previousShowIn: DesktopShowIn | undefined;
  let previousTrayIcon: DesktopTrayIcon | undefined;
  let previousCloseToTray: boolean | undefined;
  let previousAssociations: boolean | undefined;
  let previousFocusOnFileLaunch: boolean | undefined;
  let previousLaunchOnBoot: boolean | undefined;
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
      if (settings.showIn !== previousShowIn || settings.trayIcon !== previousTrayIcon) {
        await invoke('configure_desktop_visibility', { showIn: settings.showIn, trayIcon: settings.trayIcon });
        previousShowIn = settings.showIn;
        previousTrayIcon = settings.trayIcon;
      }
      if (settings.closeToTray !== previousCloseToTray) {
        await invoke('configure_desktop_close', { closeToTray: settings.closeToTray });
        previousCloseToTray = settings.closeToTray;
      }
      if (settings.launchOnBoot !== previousLaunchOnBoot) {
        await invoke('configure_desktop_autostart', { enabled: settings.launchOnBoot });
        previousLaunchOnBoot = settings.launchOnBoot;
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
    listen<unknown>(TRAY_VOLUME_STEP_EVENT, ({ payload }) => {
      if (disposed || desktopSettings.getSnapshot().showIn === 'taskbar') return;
      if (typeof payload !== 'number' || !Number.isInteger(payload) || payload === 0 || Math.abs(payload) > 1000) return;
      const volume = options.handlers.stepVolume(payload * TRAY_VOLUME_STEP);
      void emitTo('tray-bubble', BUBBLE_VOLUME_EVENT, { percent: Math.round(volume * 100) } satisfies VolumeBubble).catch(reportError);
    }),
    listen(TRAY_REQUEST_EVENT, () => { void publish(true).catch(reportError); }),
    listen<unknown>(TRAY_ACTION_EVENT, ({ payload }) => {
      if (disposed) return;
      const action = parseTrayAction(payload);
      if (!action) return;
      if (isRafMenuAction(action)) {
        runRafMenuAction(action, () => options.handlers.openOptions('raf'));
        return;
      }
      if (action === 'enterOda') {
        void invoke('restore_main_window')
          .then(() => { if (!disposed) options.handlers.enterOda(); })
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
