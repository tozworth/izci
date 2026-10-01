import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const target = 'x86_64-pc-windows-msvc';

export function desktopEnvironment(root) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === 'path' || /^WEBVIEW2_(USER_DATA_FOLDER|ADDITIONAL_BROWSER_ARGUMENTS|PIPE_FOR_SCRIPT_DEBUGGER|WAIT_FOR_SCRIPT_DEBUGGER)$/i.test(key)) delete env[key];
  }
  env.PATH = process.env.PATH;
  const local = join(root, '.local', 'desktop-toolchain');
  if (spawnSync('cargo', ['--version'], { env, windowsHide: true }).error && existsSync(join(local, 'cargo/bin/cargo.exe'))) {
    env.CARGO_HOME = join(local, 'cargo');
    env.RUSTUP_HOME = join(local, 'rustup');
    env.PATH = `${join(env.CARGO_HOME, 'bin')};${process.env.PATH}`;
  }
  env.RUSTUP_TOOLCHAIN ??= 'stable-x86_64-pc-windows-msvc';
  const rust = spawnSync('rustc', ['-vV'], { env, encoding: 'utf8', windowsHide: true });
  if (rust.error || rust.status !== 0 || rust.stdout.match(/^host: (.+)$/m)?.[1].trim() !== target) {
    throw new Error('Headless Tauri requires the Rust MSVC toolchain and Microsoft C++ Build Tools used by desktop:build.');
  }
  return env;
}

export function run(executable, args, options = {}) {
  const { acceptableExitCodes = [0], ...spawnOptions } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { ...spawnOptions, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (data) => { output += data; });
    child.once('error', reject);
    child.once('close', (code) => acceptableExitCodes.includes(code) ? resolve(output) : reject(new Error(`${executable} failed (${code}).\n${output}`)));
  });
}

export function sourceFingerprint(root) {
  const hash = createHash('sha256');
  function visit(relative) {
    const path = join(root, relative);
    if (!existsSync(path)) return;
    const entries = readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (['target', 'gen', 'node_modules', '.git'].includes(entry.name)) continue;
      const next = join(relative, entry.name);
      if (entry.isDirectory()) visit(next);
      else if (entry.isFile()) { hash.update(next); hash.update(readFileSync(join(root, next))); }
    }
  }
  for (const directory of ['src', 'src-tauri', 'public', 'scripts']) visit(directory);
  for (const file of ['package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'svelte.config.js']) {
    if (existsSync(join(root, file))) { hash.update(file); hash.update(readFileSync(join(root, file))); }
  }
  // HTML entrypoints affect embedded assets too.
  for (const name of readdirSync(root).filter((name) => name.endsWith('.html')).sort()) {
    hash.update(name); hash.update(readFileSync(join(root, name)));
  }
  return hash.digest('hex');
}

export async function ensureHeadlessBuild(root) {
  const state = join(root, '.local', 'desktop-headless');
  mkdirSync(state, { recursive: true });
  const stamp = join(state, 'build-fingerprint');
  const executable = join(root, 'src-tauri', 'target', target, 'release', 'examples', 'headless_debug.exe');
  const fingerprint = sourceFingerprint(root);
  if (existsSync(executable) && existsSync(stamp) && readFileSync(stamp, 'utf8') === fingerprint) return { executable, cached: true, fingerprint };
  console.log('Building packaged desktop assets and the hidden harness; ordinary izci.exe stays untouched.');
  const env = desktopEnvironment(root);
  await run(process.execPath, ['scripts/sync-desktop-formats.mjs'], { cwd: root, env });
  const preparedFingerprint = sourceFingerprint(root);
  const log = await run(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build', '--mode', 'desktop'], { cwd: root, env });
  const native = await run('cargo', ['build', '--release', '--target', target, '--example', 'headless_debug', '--features', 'tauri/custom-protocol'], { cwd: join(root, 'src-tauri'), env });
  writeFileSync(join(state, 'build.log'), log + native);
  const builtFingerprint = sourceFingerprint(root);
  if (builtFingerprint !== preparedFingerprint) throw new Error('Sources changed during the headless build. Run desktop:headless -- start again.');
  writeFileSync(stamp, builtFingerprint);
  return { executable, cached: false, fingerprint: builtFingerprint };
}
