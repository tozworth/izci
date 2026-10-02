import { existsSync, mkdirSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensureDesktopPacker, packDesktopExecutable } from './desktop/pack-executable.mjs';
import { verifyStandaloneExecutable } from './desktop/verify-executable.mjs';
import { publishDesktopBuild } from './desktop/publish-build.mjs';

if (process.platform !== 'win32') throw new Error('The desktop MVP is Windows-only.');
const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
if (args.some((arg) => !['--no-compress', '--with-signaling'].includes(arg))) throw new Error('Usage: npm run desktop:build -- [--no-compress] [--with-signaling]');
const signaling = args.includes('--with-signaling');
const packer = args.includes('--no-compress') ? null : await ensureDesktopPacker(root);
const env = { ...process.env };
// Windows treats PATH names case-insensitively; plain JS objects do not.
// Keep one key so child processes do not receive competing Path/PATH entries.
for (const key of Object.keys(env)) {
  if (key.toLowerCase() === 'path') delete env[key];
}
env.PATH = process.env.PATH;
const localToolchain = join(root, '.local', 'desktop-toolchain');
const systemCargo = spawnSync('cargo', ['--version'], { env, encoding: 'utf8' });
if (systemCargo.error && existsSync(join(localToolchain, 'cargo', 'bin', 'cargo.exe'))) {
  env.CARGO_HOME = join(localToolchain, 'cargo');
  env.RUSTUP_HOME = join(localToolchain, 'rustup');
  env.PATH = `${join(env.CARGO_HOME, 'bin')};${process.env.PATH}`;
}
// webview2-com statically links the loader only with MSVC; GNU needs a DLL.
env.RUSTUP_TOOLCHAIN ??= 'stable-x86_64-pc-windows-msvc';
const rust = spawnSync('rustc', ['-vV'], { env, encoding: 'utf8' });
if (rust.error || rust.status !== 0) throw new Error('Install the Rust MSVC toolchain (rustup toolchain install stable-x86_64-pc-windows-msvc) and Microsoft C++ Build Tools with the Desktop development with C++ workload before building the desktop app.');
const target = rust.stdout.match(/^host: (.+)$/m)?.[1].trim();
if (target !== 'x86_64-pc-windows-msvc') throw new Error(`Single-file desktop builds require x86_64-pc-windows-msvc; selected toolchain: ${target}`);
const cli = join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
console.log(`Building desktop ${signaling ? 'with built-in signaling (requires Go)' : 'without built-in signaling (no Go required)'}.`);
if (signaling) {
  const sync = spawnSync(process.execPath, ['scripts/sync-multiplayer-protocol.mjs'], { cwd: root, env, stdio: 'inherit' });
  if (sync.error) throw sync.error;
  if (sync.status !== 0) process.exit(sync.status ?? 1);
}
const result = spawnSync(process.execPath, [cli, 'build', '--no-bundle', '--target', target,
  ...(signaling ? ['--features', 'builtin-signaling'] : [])], { cwd: root, env, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const release = join(root, 'src-tauri', 'target', target, 'release');
const executable = join(release, 'izci.exe');
const imports = verifyStandaloneExecutable(readFileSync(executable));
console.log(`Verified standalone dependencies: ${imports.length} Windows system DLLs; no sidecar DLLs.`);
// Pack a staging copy so Cargo's output stays untouched and a failed pack never
// replaces the working build. Playback continues until publication is ready.
const staging = join(root, '.local', `desktop-packed-${process.pid}.exe`);
mkdirSync(join(root, '.local'), { recursive: true });
const output = join(root, '.local', signaling ? 'desktop-signaling' : 'desktop');
mkdirSync(output, { recursive: true });
try {
  copyFileSync(executable, staging);
  if (packer) packDesktopExecutable(packer, staging);
  await publishDesktopBuild(root, staging, { signaling });
} finally {
  rmSync(staging, { force: true });
}
// Remove the sidecar left by older GNU builds from this output directory only.
rmSync(join(output, 'WebView2Loader.dll'), { force: true });
console.log(`Desktop build: ${join(output, 'izci.exe')}`);
