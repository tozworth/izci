import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { get } from 'svelte/store';
import { t } from 'svelte-i18n';
import type { PlatformIntegrationOptions } from '$lib/services/platform-integration-types';
import { buildRafMenuItems, isRafMenuAction, runRafMenuAction } from '$lib/services/raf-menu';
import { rafSettings } from '$lib/stores/raf-settings';
import { rafPresets } from '$lib/stores/raf-presets';
import { desktopSettings } from '../settings';
import { parseTrayAction, trayItems, trayState, TRAY_ACTION_EVENT } from '../tray-protocol';

function reportError(error: unknown): void { console.error('Linux tray integration failed.', error); }

export function createPlatformIntegration(options: PlatformIntegrationOptions): () => void {
  let disposed = false;
  let release: UnlistenFn | undefined;
  let scheduled = false;
  let configured: string | undefined;
  let work = Promise.resolve();

  function schedule(): void {
    if (disposed || scheduled) return;
    scheduled = true;
    // Coalesce synchronous store changes and read the latest effective player
    // state. Serialize IPC so an older update cannot overwrite new settings.
    work = work.then(async () => {
      scheduled = false;
      if (disposed) return;
      const settings = desktopSettings.getSnapshot();
      const translate = get(t);
      const snapshot = get(options.snapshot);
      const items = settings.showIn === 'taskbar' ? [] : [
        { id: 'showMain', label: translate('desktop.tray.show') },
        { id: 'hideMain', label: translate('desktop.tray.hide') },
        ...trayItems(trayState(snapshot, options.canControl() || snapshot.backend !== null), translate,
          buildRafMenuItems({ translate, rafSettings: rafSettings.getSnapshot(), rafPresets: rafPresets.getSnapshot() }))
          .filter((item) => item.id !== 'miniPlayer')
          .map((item, index) => index === 0 ? { ...item, separatorBefore: true } : item)
      ];
      const payload = { showIn: settings.showIn, trayIcon: settings.trayIcon, closeToTray: settings.closeToTray, items };
      const key = JSON.stringify(payload);
      if (key === configured) return;
      await invoke('configure_linux_tray', payload);
      configured = key;
    }).catch(reportError);
  }

  // Subscribe after the action listener is ready: a newly created indicator is
  // immediately usable, including on cold launches with a saved tray setting.
  const unsubscribers: (() => void)[] = [];
  void listen<unknown>(TRAY_ACTION_EVENT, ({ payload }) => {
    if (disposed || desktopSettings.getSnapshot().showIn === 'taskbar') return;
    const action = parseTrayAction(payload);
    if (!action || action === 'miniPlayer') return;
    if (isRafMenuAction(action)) runRafMenuAction(action, () => options.handlers.openOptions('raf'));
    else if (action === 'enterOda') {
      void invoke('restore_main_window')
        .then(() => { if (!disposed) options.handlers.enterOda(); }).catch(reportError);
    } else options.handlers[action]();
  }).then((unlisten) => {
    if (disposed) { unlisten(); return; }
    release = unlisten;
    for (const store of [desktopSettings, options.snapshot, t, rafSettings, rafPresets]) {
      unsubscribers.push(store.subscribe(schedule));
    }
  }).catch(reportError);

  return () => {
    disposed = true;
    release?.();
    unsubscribers.forEach((unsubscribe) => unsubscribe());
  };
}
