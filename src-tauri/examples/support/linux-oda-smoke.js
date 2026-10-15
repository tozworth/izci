// Native tray entry deliberately supplies no DOM gesture. All storage belongs
// to the isolated harness profile, never the ordinary player.
if (location.pathname === '/' || location.pathname === '/index.html') {
  localStorage.setItem('izci.oda-settings', JSON.stringify({ odaEnterFullscreen: true }));
  localStorage.setItem('izci.desktop-settings', JSON.stringify({ showIn: 'both' }));
  window.addEventListener('load', async () => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const errors = [];
    window.addEventListener('error', event => {
      // WebKit reports this harmless layout notification during shell swaps.
      if (event.message !== 'ResizeObserver loop completed with undelivered notifications.') {
        errors.push(String(event.message));
      }
    });
    window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
    const wait = async (predicate, label) => {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const value = await predicate();
        if (value) return value;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error(`Timed out: ${label}`);
    };
    const state = () => invoke('oda_smoke_state');
    const enter = async () => {
      await wait(() => !navigator.userActivation?.isActive, 'no DOM user activation');
      await invoke('oda_smoke_tray_entry');
      await wait(() => document.querySelector('.oda-shell'), 'Oda shell');
      await wait(async () => {
        const current = await state();
        return current.fullscreen && current.visible;
      }, 'native fullscreen after hidden-window tray entry');
    };
    const exit = async () => {
      const options = [...document.querySelectorAll('.oda-waterfall-header')]
        .find(item => item.textContent.trim() === 'Options');
      if (!options) throw new Error('Oda Options section missing');
      options.click();
      const exit = await wait(() => [...document.querySelectorAll('.oda-card')]
        .find(item => item.textContent.includes('Exit Oda')), 'Exit Oda card');
      exit.click();
      await wait(() => !document.querySelector('.oda-shell'), 'desktop shell after exit');
    };
    try {
      await wait(() => document.querySelector('.app-shell'), 'main shell');
      await wait(async () => (await state()).tray, 'configured native tray');
      const initial = await state();
      await enter();
      if (document.fullscreenElement) throw new Error('Tray entry used DOM fullscreen');
      await exit();
      await wait(async () => !(await state()).fullscreen, 'windowed restoration');
      await wait(async () => {
        const current = await state();
        return current.width === initial.width && current.height === initial.height;
      }, 'original window dimensions');
      // A pre-existing native fullscreen session belongs to its original owner.
      await invoke('set_desktop_fullscreen', { enabled: true });
      await wait(async () => (await state()).fullscreen, 'pre-existing fullscreen');
      await enter();
      // Let the native pre-entry query complete before exiting again.
      await new Promise(resolve => setTimeout(resolve, 100));
      await exit();
      await new Promise(resolve => setTimeout(resolve, 200));
      if (!(await state()).fullscreen) throw new Error('Oda exited pre-existing fullscreen');
      await invoke('set_desktop_fullscreen', { enabled: false });
      if (errors.length) throw new Error(errors.join('; '));
      await invoke('oda_smoke_finish', { result: { ok: true, trayEntryWithoutGesture: true,
        hiddenWindowRestored: true, windowedRestoration: true, preexistingFullscreenPreserved: true } });
    } catch (error) {
      await invoke('oda_smoke_finish', { result: { ok: false, error: String(error), state: await state(), errors } });
    }
  });
}
