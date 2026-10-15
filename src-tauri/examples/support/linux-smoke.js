// Operate the mounted app through its ordinary menu and track row events.
// Related WebKit views inherit initialization scripts; only the owner runs it.
if (window.location.pathname === '/' || window.location.pathname === '/index.html') {
// Make repeated folder imports observable despite the optional queue dedupe.
localStorage.setItem('izci.track-settings', JSON.stringify({ deduplicateQueue: false }));
localStorage.setItem('izci.appearance-settings', JSON.stringify({ colorThemeMode: 'light' }));
const smokeContexts = [];
const smokeMedia = new Set();
const smokePopups = [];
const nativeOpen = window.open;
window.open = function(...args) {
  const popup = nativeOpen.apply(this, args);
  smokePopups.push(popup);
  return popup;
};
const NativeAudioContext = window.AudioContext;
window.AudioContext = class extends NativeAudioContext {
  constructor(...args) { super(...args); smokeContexts.push(this); }
};
const nativePlay = HTMLMediaElement.prototype.play;
HTMLMediaElement.prototype.play = function(...args) {
  smokeMedia.add(this);
  return nativePlay.apply(this, args);
};
window.addEventListener('load', async () => {
  const invoke = window.__TAURI_INTERNALS__.invoke;
  const paths = __SMOKE_PATHS__;
  const errors = [];
  window.addEventListener('error', event => errors.push(String(event.message)));
  window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
  const wait = async (predicate, label) => {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      const result = await predicate();
      if (result) return result;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out: ${label}; errors: ${errors.join('; ')}; UI: ${document.body.innerText.slice(0, 1800)}`);
  };
  const results = [];
  try {
    await wait(() => document.querySelector('.app-shell'), 'main shell');
    const openOptions = async () => {
      document.querySelector('.app-menu-trigger').click();
      const action = await wait(() => Array.from(document.querySelectorAll('[role="menuitem"]'))
        .find(button => button.textContent.includes('Options')), 'Options action');
      action.click();
    };
    await openOptions();
    const options = await wait(() => smokePopups.at(-1), 'Options window reference');
    await wait(() => options.document.querySelector('.options-page-host'), 'Options content');
    await wait(async () => (await invoke('smoke_windows')).find(window => window.url?.includes('/options.html') && window.visible), 'visible native Options');
    if (options.opener !== window) throw new Error('Options lost its opener');
    if (options.__TAURI_INTERNALS__.metadata.currentWindow.label === 'main') {
      throw new Error('Options inherited the main native window identity');
    }
    const appearance = await wait(() => options.document.querySelector('[role="combobox"][aria-label="Appearance"]'), 'Appearance setting');
    appearance.click();
    const dark = await wait(() => Array.from(options.document.querySelectorAll('[role="option"]'))
      .find(option => option.textContent.includes('Dark')), 'Dark appearance option');
    dark.click();
    await wait(() => document.documentElement.dataset.colorScheme === 'dark'
      && options.document.documentElement.dataset.colorScheme === 'dark', 'settings sync to player');
    await openOptions();
    if (smokePopups.length !== 1) throw new Error('Options did not reuse the existing window');
    options.document.querySelector('.close-control').click();
    await wait(() => options.closed, 'Options close');
    await openOptions();
    await wait(() => smokePopups.at(-1)?.document.querySelector('.options-page-host'), 'reopened Options content');
    const reopenedOptions = smokePopups.at(-1);
    reopenedOptions.document.querySelector('.close-control').click();
    await wait(() => reopenedOptions.closed, 'reopened Options close');
    // Edit the real synchronized settings in Options; the playback owner must
    // create and update its indicator rather than the Options window doing it.
    await openOptions();
    const trayOptions = await wait(() => smokePopups.at(-1)?.document.querySelector('.options-page-host') && smokePopups.at(-1), 'tray Options');
    const showIn = await wait(() => Array.from(trayOptions.document.querySelectorAll('select'))
      .find(select => Array.from(select.options).some(option => option.value === 'taskbar')), 'Show in setting');
    const setShowIn = value => { showIn.value = value; showIn.dispatchEvent(new Event('change', { bubbles: true })); };
    setShowIn('both');
    await wait(async () => (await invoke('smoke_tray')).available, 'native tray creation from Options');
    await invoke('smoke_tray', { action: 'hideMain' });
    await wait(async () => !(await invoke('smoke_windows')).find(window => window.label === 'main').visible, 'tray Hide');
    // Disabling the tray from a surviving Options window must restore access.
    setShowIn('taskbar');
    await wait(async () => !(await invoke('smoke_tray')).available
      && (await invoke('smoke_windows')).find(window => window.label === 'main').visible, 'safe tray removal');
    setShowIn('tray');
    await wait(async () => (await invoke('smoke_tray')).available, 'tray recreation');
    await invoke('smoke_tray', { action: 'hideMain' });
    await invoke('smoke_tray', { action: 'showMain' });
    await wait(async () => (await invoke('smoke_windows')).find(window => window.label === 'main').visible, 'tray Show');
    trayOptions.document.querySelector('.close-control').click();
    await wait(() => trayOptions.closed, 'tray Options close');
    await invoke('smoke_tray', { action: 'openOptions' });
    const closeOptions = await wait(() => smokePopups.at(-1)?.document.querySelector('.options-page-host') && smokePopups.at(-1), 'Options from tray');
    closeOptions.document.querySelector('[aria-label^="Show advanced tweaks"]')?.click();
    const closeField = await wait(() => Array.from(closeOptions.document.querySelectorAll('.field'))
      .find(field => field.querySelector('.field-title')?.textContent === 'Close to tray'), 'Close to tray setting');
    const closeCheckbox = closeField.querySelector('input[type="checkbox"]');
    closeCheckbox.checked = true;
    closeCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(async () => (await invoke('smoke_tray')).closeToTray, 'close policy sync');
    document.querySelector('.close-control').click();
    await wait(async () => !(await invoke('smoke_windows')).find(window => window.label === 'main').visible, 'close keeps player alive in tray');
    await invoke('smoke_tray', { action: 'showMain' });
    await wait(async () => (await invoke('smoke_windows')).find(window => window.label === 'main').visible, 'restore after close');
    closeOptions.document.querySelector('.close-control').click();
    await wait(() => closeOptions.closed, 'close-policy Options close');
    // Let the native close/focus events settle before opening the next menu.
    await new Promise(resolve => setTimeout(resolve, 200));
    document.querySelector('button[aria-label="Mute"]')?.click();
    for (const path of paths) {
      const fileMenu = await wait(() => document.querySelector('button[aria-label="File"]'), 'File menu');
      fileMenu.click();
      const open = await wait(() => Array.from(document.querySelectorAll('[role="menuitem"]'))
        .find(button => button.textContent.includes('Open files')), 'Open files action');
      open.click();
      const name = path.split('/').at(-1);
      const row = await wait(() => document.querySelectorAll('[data-track-row-button]')[results.length], `import ${name}`);
      if (!row.textContent.toLowerCase().includes(name.split('.').at(-1).toLowerCase())) {
        throw new Error(`Wrong file selected for ${name}: ${row.textContent}`);
      }
      row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await wait(() => document.querySelector('button[aria-label="Pause playback"]'), `play ${name}`);
      const seek = await wait(() => document.querySelector('.range-control input[type="range"]:not(:disabled)'), 'seek control');
      const start = Number(seek.value);
      await wait(() => Number(seek.value) > start + 0.5, `advancing playback ${name}`);
      results.push({ name, position: Number(seek.value), duration: Number(seek.max) });
      // Exercise native callback -> Tauri event -> existing transport handler.
      await invoke('smoke_tray', { action: 'hideMain' });
      await invoke('smoke_tray', { action: 'togglePlayback' });
      await wait(() => document.querySelector('button[aria-label="Resume playback"]')
        || document.querySelector('button[aria-label="Start playback"]')
        || !document.querySelector('button[aria-label="Pause playback"]'), 'tray Pause');
      await invoke('smoke_tray', { action: 'togglePlayback' });
      await wait(() => document.querySelector('button[aria-label="Pause playback"]'), 'tray Play');
      const hiddenStart = Number(seek.value);
      await wait(() => Number(seek.value) > hiddenStart + 0.5, `hidden playback ${name}`);
      await invoke('smoke_tray', { action: 'showMain' });
      document.querySelector('button[aria-label="Pause playback"]').click();
    }
    document.querySelector('button[aria-label="File"]').click();
    const folderAction = await wait(() => Array.from(document.querySelectorAll('[role="menuitem"]'))
      .find(button => button.textContent.includes('Open folder')), 'Open folder action');
    folderAction.click();
    await wait(() => document.querySelectorAll('[data-track-row-button]').length > results.length, 'folder import');
    const count = document.querySelectorAll('[data-track-row-button]').length;
    document.querySelector('button[aria-label="File"]').click();
    const cancelAction = await wait(() => Array.from(document.querySelectorAll('[role="menuitem"]'))
      .find(button => button.textContent.includes('Open files')), 'cancel picker action');
    cancelAction.click();
    await new Promise(resolve => setTimeout(resolve, 1500));
    if (document.querySelectorAll('[data-track-row-button]').length !== count || errors.length) {
      throw new Error('Cancellation changed the queue or produced an error');
    }
    await invoke('smoke_report', { result: { ok: true, shell: true, nativePicker: true,
      folderPicker: true, cancellation: true, options: true, settingsSync: true, tray: true, playback: results, errors } });
  } catch (error) {
    const media = Array.from(smokeMedia).map(element => ({
      time: element.currentTime, paused: element.paused, readyState: element.readyState,
      error: element.error?.message
    }));
    const contexts = smokeContexts.map(context => ({ state: context.state, time: context.currentTime }));
    await invoke('smoke_report', { result: { ok: false, error: String(error), windows: await invoke('smoke_windows'), playback: results, media, contexts, errors } });
  }
});
}
