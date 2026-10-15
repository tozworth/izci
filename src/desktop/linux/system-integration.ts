import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { get } from 'svelte/store';
import { t } from 'svelte-i18n';
import type { PlatformIntegrationOptions } from '$lib/services/platform-integration-types';
import type { MenuActionItem } from '$lib/types';
import { buildRafMenuItems, isRafMenuAction, runRafMenuAction } from '$lib/services/raf-menu';
import { rafSettings } from '$lib/stores/raf-settings';
import { rafPresets } from '$lib/stores/raf-presets';
import { desktopSettings } from '../settings';
import { TRAY_ACTION_EVENT } from '../tray-protocol';

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
    // Coalesce synchronous store changes and serialize IPC so an older update
    // cannot overwrite new settings.
    work = work.then(async () => {
      scheduled = false;
      if (disposed) return;
      const settings = desktopSettings.getSnapshot();
      const translate = get(t);
      const items: MenuActionItem[] = settings.showIn === 'taskbar' ? [] : [
        { id: 'showMain', label: translate('desktop.tray.show') },
        { id: 'raf', label: translate('options.views.raf'), separatorBefore: true,
          children: buildRafMenuItems({ translate, rafSettings: rafSettings.getSnapshot(), rafPresets: rafPresets.getSnapshot() }) },
        { id: 'openOptions', label: translate('main.menu.options') },
        { id: 'enterOda', label: translate('desktop.tray.oda'), separatorBefore: true },
        { id: 'exit', label: translate('desktop.tray.exit') }
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
    const action = payload;
    if (typeof action !== 'string') return;
    if (isRafMenuAction(action)) runRafMenuAction(action, () => options.handlers.openOptions('raf'));
    else if (action === 'enterOda') {
      void invoke('restore_main_window')
        .then(() => { if (!disposed) options.handlers.enterOda(); }).catch(reportError);
    } else if (action === 'openOptions' || action === 'exit') options.handlers[action]();
  }).then((unlisten) => {
    if (disposed) { unlisten(); return; }
    release = unlisten;
    for (const store of [desktopSettings, t, rafSettings, rafPresets]) {
      unsubscribers.push(store.subscribe(schedule));
    }
  }).catch(reportError);

  return () => {
    disposed = true;
    release?.();
    unsubscribers.forEach((unsubscribe) => unsubscribe());
  };
}
