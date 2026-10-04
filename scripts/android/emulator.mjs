import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { root, sdk, adb, emulator, avd, serial, directory, apk, device, run, pause, setup, assertDevice } from './tools.mjs';
import { withWebView, evaluate } from './webview.mjs';
import { connectCdp } from './cdp.mjs';
import { checkDebugApk } from './debug-build.mjs';

const [command = 'help', ...args] = process.argv.slice(2);
const usage = 'android:emulator -- setup | start [--window] | install | status | stop | reload | eval (--expression <JS> | --script <file>) | debug --script <module.mjs> | logs [--dump] | screenshot [file.png] | adb <arguments...>';
const stateFile = join(directory, 'installed.json');
const print = (value) => console.log(JSON.stringify(value, null, 2));
function state() { try { return JSON.parse(readFileSync(stateFile, 'utf8')); } catch { return {}; } }
function hashApk() {
  if (!existsSync(apk)) throw new Error(`APK missing: ${apk}. Build explicitly with npm run android:build.`);
  const bytes = readFileSync(apk);
  checkDebugApk(bytes);
  return createHash('sha256').update(bytes).digest('hex');
}
function connected() { return run(adb, ['devices']).stdout.split(/\r?\n/).some((line) => line.startsWith(`${serial}\t`)); }
function requireDevice() { if (!assertDevice()) throw new Error('Emulator is stopped. Run android:emulator -- start.'); }
async function boot(child) {
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) {
      throw new Error(`Emulator exited during boot. Check ${directory}/emulator.stderr.log.`);
    }
    const result = device(['shell', 'getprop', 'sys.boot_completed'], { allowFailure: true });
    if (result.status === 0 && result.stdout.trim() === '1') return;
    await pause(1000);
  }
  throw new Error(`Emulator did not boot within four minutes. Check ${directory}/emulator.stderr.log.`);
}
function install() {
  const sha256 = hashApk();
  device(['install', '-r', apk], { inherit: true });
  mkdirSync(directory, { recursive: true });
  writeFileSync(stateFile, JSON.stringify({ sha256, apk, installedAt: new Date().toISOString() }, null, 2));
}
function launch() {
  const pid = device(['shell', 'pidof', 'app.izci.android'], { allowFailure: true });
  if (pid.status !== 0) device(['shell', 'am', 'start', '-W', '-n', 'app.izci.android/.MainActivity'], { inherit: true });
}

try {
  if (command === 'help' || args.includes('--help')) {
    console.log(usage);
  } else if (command === 'setup') {
    if (args.length) throw new Error(usage);
    await setup();
  } else {
    if (!existsSync(adb)) throw new Error(`ADB missing in ${sdk}. Run android:emulator -- setup.`);
    if (command === 'start') {
      if (args.some((arg) => arg !== '--window')) throw new Error(usage);
      const sha256 = hashApk();
      let child;
      if (!connected()) {
        if (!existsSync(emulator)) throw new Error('Emulator missing. Run android:emulator -- setup.');
        run(emulator, ['-accel-check']);
        mkdirSync(directory, { recursive: true });
        const stdout = openSync(join(directory, 'emulator.stdout.log'), 'a');
        const stderr = openSync(join(directory, 'emulator.stderr.log'), 'a');
        child = spawn(emulator, ['-avd', avd, '-port', '5554', '-no-boot-anim',
          ...(args.includes('--window') ? [] : ['-no-window', '-no-audio'])],
        { env: { ...process.env, ANDROID_HOME: sdk }, detached: true, windowsHide: true, stdio: ['ignore', stdout, stderr] });
        closeSync(stdout); closeSync(stderr);
        await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
        child.unref();
        console.log(`Booting ${avd}${args.includes('--window') ? ' with a window' : ' headless'}...`);
      }
      await boot(child);
      requireDevice();
      const present = device(['shell', 'pm', 'path', 'app.izci.android']).stdout.trim();
      if (state().sha256 !== sha256 || !present) install();
      launch();
      const webview = await withWebView((target) => evaluate(target,
        'new Promise(resolve => { const ready = () => resolve({title: document.title, ready: document.readyState}); if (document.readyState === "complete") ready(); else window.addEventListener("load", ready, {once: true}); })'));
      print({ running: true, avd, serial, apk, webview, logs: directory, devtools: 'chrome://inspect/#devices' });
    } else if (command === 'status') {
      if (args.length) throw new Error(usage);
      if (!connected()) print({ running: false, avd, serial, sdk, apk });
      else {
        requireDevice();
        print({ running: true, avd, serial, sdk, booted: device(['shell', 'getprop', 'sys.boot_completed']).stdout.trim() === '1',
          pid: device(['shell', 'pidof', 'app.izci.android'], { allowFailure: true }).stdout.trim() || null,
          installed: state(), logs: directory });
      }
    } else if (command === 'stop') {
      if (args.length) throw new Error(usage);
      if (assertDevice()) {
        device(['emu', 'kill']);
        const deadline = Date.now() + 15_000;
        while (connected() && Date.now() < deadline) await pause(250);
        if (connected()) throw new Error('Emulator shutdown has not completed.');
      }
      print({ running: false, profileRetained: true });
    } else {
      requireDevice();
      if (command === 'install') {
        if (args.length) throw new Error(usage);
        install(); launch();
        print(await withWebView((target) => evaluate(target, '({title: document.title, ready: document.readyState})')));
      } else if (command === 'adb') {
        if (!args.length || args[0].startsWith('-')) throw new Error('Pass ADB command arguments only; the izci emulator is already selected.');
        run(adb, ['-s', serial, ...args], { inherit: true });
      } else if (command === 'logs') {
        if (args.some((arg) => arg !== '--dump')) throw new Error(usage);
        const pid = device(['shell', 'pidof', 'app.izci.android']).stdout.trim().split(' ')[0];
        if (!pid) throw new Error('izci is not running.');
        device(['logcat', `--pid=${pid}`, ...(args.includes('--dump') ? ['-d', '-t', '500'] : [])], { inherit: true });
      } else if (command === 'screenshot') {
        if (args.length > 1) throw new Error(usage);
        const path = resolve(root, args[0] || '.local/android-emulator/screen.png');
        mkdirSync(directory, { recursive: true });
        writeFileSync(path, device(['exec-out', 'screencap', '-p'], { binary: true }).stdout);
        print({ screenshot: path });
      } else if (command === 'eval') {
        if (args.length !== 2 || !['--expression', '--script'].includes(args[0])) throw new Error(usage);
        const expression = args[0] === '--script' ? readFileSync(resolve(root, args[1]), 'utf8') : args[1];
        print(await withWebView((target) => evaluate(target, expression)));
      } else if (command === 'reload' || command === 'debug') {
        if (command === 'reload' ? args.length : args.length !== 2 || args[0] !== '--script') throw new Error(usage);
        const script = command === 'debug' ? await import(pathToFileURL(resolve(root, args[1])).href) : null;
        if (script && typeof script.default !== 'function') throw new Error('Debug script must export a default async function receiving { cdp, target }.');
        print(await withWebView(async (target) => {
          const cdp = await connectCdp(target.webSocketDebuggerUrl);
          try {
            if (script) return await script.default({ cdp, target });
            await cdp.send('Page.reload', { ignoreCache: true });
            return { reloaded: true };
          } finally {
            // Don't leave the player frozen if a breakpoint script fails or finishes.
            await cdp.send('Debugger.resume', {}, { timeoutMs: 1000 }).catch(() => {});
            cdp.close();
          }
        }));
      } else throw new Error(usage);
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
