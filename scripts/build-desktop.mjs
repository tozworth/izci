import { existsSync, mkdirSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensureDesktopPacker, packDesktopExecutable } from './desktop/pack-executable.mjs';
import { verifyStandaloneExecutable } from './desktop/verify-executable.mjs';

if (process.platform !== 'win32') throw new Error('The desktop MVP is Windows-only.');
const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--no-compress')) throw new Error('Usage: npm run desktop:build -- [--no-compress]');
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
const result = spawnSync(process.execPath, [cli, 'build', '--no-bundle', '--target', target], { cwd: root, env, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const release = join(root, 'src-tauri', 'target', target, 'release');
const executable = join(release, 'izci.exe');
const imports = verifyStandaloneExecutable(readFileSync(executable));
console.log(`Verified standalone dependencies: ${imports.length} Windows system DLLs; no sidecar DLLs.`);
// Pack a staging copy so Cargo's output stays untouched and a failed pack never
// replaces the working build. A running player keeps the existing fallback.
const staging = join(root, '.local', `desktop-packed-${process.pid}.exe`);
mkdirSync(join(root, '.local'), { recursive: true });
let output = join(root, '.local', 'desktop');
mkdirSync(output, { recursive: true });
try {
  copyFileSync(executable, staging);
  if (packer) packDesktopExecutable(packer, staging);
  try {
    copyFileSync(staging, join(output, 'izci.exe'));
  } catch (error) {
    if (error.code !== 'EBUSY' && error.code !== 'EPERM' && error.code !== 'EACCES') throw error;
    // A running Windows executable is locked. Preserve the user's playback session.
    output = join(root, '.local', 'desktop-next');
    mkdirSync(output, { recursive: true });
    copyFileSync(staging, join(output, 'izci.exe'));
    console.log(`Could not replace the current desktop executable (${error.code}); saved the new build separately.`);
  }
} finally {
  rmSync(staging, { force: true });
}
// Remove the sidecar left by older GNU builds from this output directory only.
rmSync(join(output, 'WebView2Loader.dll'), { force: true });
console.log(`Desktop build: ${join(output, 'izci.exe')}`);
