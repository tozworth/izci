import { existsSync, readdirSync, mkdirSync, createWriteStream, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const root = resolve(import.meta.dirname, '../..');
export const toolsRoot = join(process.env.LOCALAPPDATA || process.env.HOME || root, 'izci-android-tools');
export const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || join(toolsRoot, 'sdk');
export const avd = 'izci_android16';
export const serial = 'emulator-5554';
export const image = 'system-images;android-36;google_apis;x86_64';
export const directory = join(root, '.local/android-emulator');
export const apk = join(root, 'artifacts/android/izci.apk');
export const adb = join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
export const emulator = join(sdk, 'emulator', process.platform === 'win32' ? 'emulator.exe' : 'emulator');
export const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function javaHome() {
  const local = join(toolsRoot, 'jdk');
  const entry = existsSync(local) && readdirSync(local, { withFileTypes: true }).find((entry) => entry.isDirectory());
  return entry ? join(local, entry.name) : process.env.JAVA_HOME;
}

export function run(file, args, { allowFailure = false, inherit = false, binary = false } = {}) {
  const env = { ...process.env, ANDROID_HOME: sdk, JAVA_HOME: javaHome() };
  const batch = file.endsWith('.bat');
  if (batch) Object.assign(env, { IZCI_ANDROID_TOOL: file, IZCI_ANDROID_ARGS: JSON.stringify(args) });
  const result = spawnSync(batch ? 'powershell.exe' : file, batch ? ['-NoProfile', '-Command',
    '$toolArgs = @(ConvertFrom-Json $env:IZCI_ANDROID_ARGS); & $env:IZCI_ANDROID_TOOL @toolArgs; exit $LASTEXITCODE'] : args,
  { env, windowsHide: true, stdio: inherit ? 'inherit' : 'pipe', encoding: binary ? undefined : 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: inherit ? undefined : 30_000 });
  if (!allowFailure && (result.error || result.status !== 0)) {
    throw new Error(result.error?.message || String(result.stderr || result.stdout || `${file} exited ${result.status}`).trim());
  }
  return result;
}

export function device(args, options) { return run(adb, ['-s', serial, ...args], options); }
export function sdkTool(name) {
  const base = join(sdk, 'cmdline-tools');
  const suffix = process.platform === 'win32' ? '.bat' : '';
  for (const entry of existsSync(base) ? readdirSync(base) : []) {
    const path = join(base, entry, 'bin', name + suffix);
    if (existsSync(path)) return path;
  }
  throw new Error('Android command-line tools missing. Run android:emulator -- setup.');
}

export function assertDevice() {
  const devices = run(adb, ['devices']).stdout;
  if (!devices.split(/\r?\n/).some((line) => line.startsWith(`${serial}\t`))) return false;
  const name = device(['emu', 'avd', 'name']).stdout.split(/\r?\n/)[0].trim();
  if (name !== avd) throw new Error(`${serial} belongs to ${name}, not ${avd}. Close that emulator or free port 5554.`);
  return true;
}

export async function setup() {
  if (process.platform !== 'win32') throw new Error('Automated SDK bootstrap is Windows-only; provision the SDK manually on other hosts.');
  if (!javaHome()) throw new Error('Install JDK 17 and set JAVA_HOME (see src/android/README.md).');
  mkdirSync(directory, { recursive: true });
  try { sdkTool('sdkmanager'); } catch {
    const zip = join(directory, 'commandline-tools.zip');
    const response = await fetch('https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip');
    if (!response.ok) throw new Error(`SDK download failed: ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(zip));
    const hash = createHash('sha256').update(readFileSync(zip)).digest('hex');
    if (hash !== '90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a') throw new Error('SDK archive checksum mismatch.');
    mkdirSync(join(sdk, 'cmdline-tools'), { recursive: true });
    const extraction = spawnSync('powershell.exe', ['-NoProfile', '-Command',
      'Expand-Archive -LiteralPath $env:IZCI_ANDROID_ZIP -DestinationPath $env:IZCI_ANDROID_DEST'],
    { env: { ...process.env, IZCI_ANDROID_ZIP: zip, IZCI_ANDROID_DEST: join(sdk, 'cmdline-tools') }, stdio: 'inherit', windowsHide: true });
    if (extraction.status !== 0) throw new Error('SDK extraction failed.');
  }
  run(sdkTool('sdkmanager'), [`--sdk_root=${sdk}`, 'platform-tools', 'emulator', image], { inherit: true });
  const avds = run(sdkTool('avdmanager'), ['list', 'avd', '-c']).stdout;
  if (!avds.split(/\r?\n/).includes(avd)) {
    run(sdkTool('avdmanager'), ['create', 'avd', '-n', avd, '-k', image, '-d', 'pixel_7'], { inherit: true });
  }
  run(emulator, ['-accel-check'], { inherit: true });
  console.log(`Ready: ${avd}; SDK: ${sdk}`);
}
