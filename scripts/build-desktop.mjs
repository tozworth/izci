import { existsSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

if (process.platform !== 'win32') throw new Error('The desktop MVP is Windows-only.');
const root = resolve(import.meta.dirname, '..');
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
let output = join(root, '.local', 'desktop');
mkdirSync(output, { recursive: true });
try {
  copyFileSync(join(release, 'izci.exe'), join(output, 'izci.exe'));
} catch (error) {
  if (error.code !== 'EBUSY' && error.code !== 'EPERM' && error.code !== 'EACCES') throw error;
  // A running Windows executable is locked. Preserve the user's playback session.
  output = join(root, '.local', 'desktop-next');
  mkdirSync(output, { recursive: true });
  copyFileSync(join(release, 'izci.exe'), join(output, 'izci.exe'));
  console.log(`Could not replace the current desktop executable (${error.code}); saved the new build separately.`);
}
// Remove the sidecar left by older GNU builds from this output directory only.
rmSync(join(output, 'WebView2Loader.dll'), { force: true });
console.log(`Desktop build: ${join(output, 'izci.exe')}`);
