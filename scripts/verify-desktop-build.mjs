import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const browser = join(root, 'dist');
const desktop = join(root, 'dist-desktop');
assert(existsSync(join(browser, 'sw.js')), 'Build the PWA first with npm run build.');
assert(existsSync(join(desktop, 'index.html')), 'Build desktop assets with npm run desktop:frontend.');
if (existsSync(join(desktop, 'mini-player.html'))) {
  assert(['tray-menu.html', 'tray-bubble.html'].every((name) => existsSync(join(desktop, name))), 'Windows desktop utility pages are missing.');
}
const nativeMarkers = /izciSaf|\/__saf\?uri=|__TAURI_INTERNALS__|(?:start|stop)_builtin_signaling|signaling_http|(?:open|send)_signaling_socket|izci:desktop-(?:mini-|tray-|files-available)|izci\.desktop-settings|open_mini_player|pin_mini_player|restore_main_window|desktop_window_ready|present_desktop_popup|local_font_families|configure_desktop_(?:tray|associations)|(?:show|hide)_desktop_tray_menu|open_desktop_default_apps|(?:materialize_desktop_files|take_desktop_launch_paths)|plugin:window\|(?:minimize|toggle_maximize|start_dragging|is_maximized|is_focused|close)/;
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]);
}
for (const path of files(browser)) {
  assert(!/(?:mini-player|tray-menu|tray-bubble)\.html|android-debug\.json|\.(?:exe|dll|apk)$/i.test(path), `Native file shipped in PWA: ${path}`);
  if (/\.(?:js|html|json)$/.test(path)) {
    assert(!nativeMarkers.test(readFileSync(path, 'utf8')), `Native code shipped in PWA: ${path}`);
  }
}
const sw = readFileSync(join(browser, 'sw.js'), 'utf8');
assert(!/(?:mini-player|tray-menu|tray-bubble)\.html|dist-desktop|src-tauri|desktop-(?:mini|tray)/i.test(sw), 'Desktop assets appear in the PWA precache.');
assert(!existsSync(join(desktop, 'sw.js')), 'Desktop build generated a service worker.');
assert(!existsSync(join(desktop, 'manifest.webmanifest')), 'Desktop build generated a PWA manifest.');
assert(files(join(desktop, 'assets')).some((path) => path.endsWith('.js') && nativeMarkers.test(readFileSync(path, 'utf8'))), 'Desktop bridge missing from native build.');
const moduleAssets = readdirSync(join(desktop, 'assets'));
assert(moduleAssets.some((name) => /^libopenmpt-.*\.wasm$/.test(name)), 'Desktop libopenmpt WASM is missing.');
assert(moduleAssets.some((name) => /^playback.worklet-.*\.js$/.test(name)), 'Desktop libopenmpt worklet is missing.');
assert(moduleAssets.some((name) => /^decoder.worker-.*\.js$/.test(name)), 'Desktop libopenmpt decoder worker is missing.');
console.log('Verified: desktop bridge is present only in desktop assets; PWA code and precache are browser-only.');
