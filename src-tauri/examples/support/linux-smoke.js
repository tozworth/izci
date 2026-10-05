// Operate the mounted app through its ordinary menu and track row events.
// Make repeated folder imports observable despite the optional queue dedupe.
localStorage.setItem('izci.track-settings', JSON.stringify({ deduplicateQueue: false }));
const smokeContexts = [];
const smokeMedia = new Set();
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
      const result = predicate();
      if (result) return result;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out: ${label}; errors: ${errors.join('; ')}; UI: ${document.body.innerText.slice(0, 1800)}`);
  };
  const results = [];
  try {
    await wait(() => document.querySelector('.app-shell'), 'main shell');
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
      folderPicker: true, cancellation: true, playback: results, errors } });
  } catch (error) {
    const media = Array.from(smokeMedia).map(element => ({
      time: element.currentTime, paused: element.paused, readyState: element.readyState,
      error: element.error?.message
    }));
    const contexts = smokeContexts.map(context => ({ state: context.state, time: context.currentTime }));
    await invoke('smoke_report', { result: { ok: false, error: String(error), playback: results, media, contexts, errors } });
  }
});
