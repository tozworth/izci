import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { checkDebugFrontend } from './android/debug-build.mjs';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
if (args.some((arg) => !['--skip-web', '--test-only'].includes(arg))) throw new Error('Usage: npm run android:build -- [--skip-web | --test-only]');
const env = { ...process.env };
const tools = process.platform === 'win32' && process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'izci-android-tools') : null;
const localJava = tools && existsSync(join(tools, 'jdk')) ? readdirSync(join(tools, 'jdk'), { withFileTypes: true }).find((entry) => entry.isDirectory())?.name : null;
// The locally provisioned JDK 17 also avoids an incompatible system JDK (e.g. 25).
env.JAVA_HOME = localJava ? join(tools, 'jdk', localJava) : process.env.JAVA_HOME;
env.ANDROID_HOME = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || (tools ? join(tools, 'sdk') : undefined);
if (!env.JAVA_HOME || !env.ANDROID_HOME || !existsSync(env.ANDROID_HOME)) throw new Error('Install JDK 17 and Android SDK 36, then set JAVA_HOME and ANDROID_HOME. See src/android/README.md.');

function run(command, arguments_, cwd = root, options = {}) {
  const result = spawnSync(command, arguments_, { cwd, env, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!args.includes('--skip-web') && !args.includes('--test-only')) {
  run(process.execPath, [join(root, 'scripts/android/frontend.mjs')]);
}
checkDebugFrontend(pathToFileURL(join(root, 'dist-android') + '/'));
const tasks = args.includes('--test-only') ? ['testDebugUnitTest'] : ['testDebugUnitTest', 'assembleDebug'];
const android = join(root, 'android');
const wrapper = join(android, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
if (process.platform === 'win32') {
  // cmd only launches the checked-in wrapper with fixed task names; no shell file operations.
  run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'gradlew.bat', ...tasks, '--console=plain'], android, { windowsVerbatimArguments: true });
} else run(wrapper, [...tasks, '--console=plain'], android);

if (!args.includes('--test-only')) {
  const output = join(root, 'artifacts/android');
  mkdirSync(output, { recursive: true });
  copyFileSync(join(android, 'app/build/outputs/apk/debug/app-debug.apk'), join(output, 'izci.apk'));
  console.log(`Android MVP: ${join(output, 'izci.apk')} (debug signed)`);
}
