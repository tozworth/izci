import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';

export function assertDebugBuild(value) {
  if (value?.development !== true || value?.minified !== false || value?.sourcemaps !== true) {
    throw new Error('Android debugging requires development web assets with source maps and no minification. Run npm run android:build.');
  }
  return value;
}

export function checkDebugFrontend(directory) {
  let value;
  try { value = JSON.parse(readFileSync(new URL('android-debug.json', directory), 'utf8')); } catch { /* Validated below. */ }
  return assertDebugBuild(value);
}

export function checkDebugApk(bytes) {
  const entries = unzipSync(bytes, { filter: ({ name }) => name === 'assets/web/android-debug.json' });
  let value;
  try { value = JSON.parse(new TextDecoder().decode(entries['assets/web/android-debug.json'])); } catch { /* Validated below. */ }
  return assertDebugBuild(value);
}
