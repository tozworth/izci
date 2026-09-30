import { renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

function stopLocalPlayer(root) {
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', join(root, 'scripts', 'desktop', 'restart-local-player.ps1'),
    '-WorkspaceRoot', root,
  ], { encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Could not stop local izci: ${result.stderr.trim()}`);
  const running = JSON.parse(result.stdout.trim());
  const allowed = [join(root, '.local', 'desktop', 'izci.exe'), join(root, '.local', 'desktop-next', 'izci.exe')];
  if (!Array.isArray(running) || running.some((path) => typeof path !== 'string'
    || !allowed.some((candidate) => candidate.toLowerCase() === path.toLowerCase()))) {
    throw new Error('Unexpected executable path returned by local izci shutdown.');
  }
  return running;
}

function startLocalPlayer(executable) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [], {
      cwd: dirname(executable), detached: true, stdio: 'ignore', windowsHide: true,
    });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

// Called only after a complete, verified build has been staged. Only local
// output paths are eligible for shutdown; other installed copies stay untouched.
export async function publishDesktopBuild(root, staging, {
  stop = stopLocalPlayer, start = startLocalPlayer, replace = renameSync,
} = {}) {
  const executable = join(root, '.local', 'desktop', 'izci.exe');
  const running = stop(root);
  if (running.length) console.log('Restarting local izci with the completed build.');
  try {
    // Same-volume atomic replacement leaves the previous executable intact if
    // an unrelated file lock or filesystem error prevents installation.
    replace(staging, executable);
  } catch (error) {
    if (running.length) await start(running[0]);
    throw error;
  }
  if (running.length) await start(executable);
  return executable;
}
