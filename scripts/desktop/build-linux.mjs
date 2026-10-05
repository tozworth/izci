import { copyFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

export function buildLinuxDesktop(root, args) {
  if (args.length) throw new Error('Linux MVP usage: npm run desktop:build (built-in signaling and executable packing are Windows-only).');
  const env = { ...process.env, IZCI_DESKTOP_OS: 'linux' };
  const rustupBin = join(homedir(), '.cargo', 'bin');
  if (spawnSync('cargo', ['--version'], { env }).error && existsSync(join(rustupBin, 'cargo'))) {
    env.PATH = `${rustupBin}:${env.PATH ?? ''}`;
  }
  const rust = spawnSync('rustc', ['-vV'], { env, encoding: 'utf8' });
  const target = rust.stdout?.match(/^host: (.+)$/m)?.[1].trim();
  if (rust.error || rust.status !== 0 || !target?.includes('-linux-')) {
    throw new Error('Install a native Linux Rust toolchain with rustup before building izci. See src/desktop/README.md for system dependencies.');
  }
  console.log(`Building Linux desktop MVP (${target}).`);
  const cli = join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
  const result = spawnSync(process.execPath, [cli, 'build', '--no-bundle', '--target', target], {
    cwd: root, env, stdio: 'inherit'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  const output = join(root, '.local', 'desktop-linux');
  mkdirSync(output, { recursive: true });
  // Copy to a new inode so rebuilding also works while the old app is running.
  const executable = join(output, `izci-${process.pid}`);
  copyFileSync(join(root, 'src-tauri', 'target', target, 'release', 'izci'), executable);
  // A rename publishes the complete binary atomically without restarting izci.
  renameSync(executable, join(output, 'izci'));
  console.log(`Linux build: ${join(output, 'izci')}`);
}

