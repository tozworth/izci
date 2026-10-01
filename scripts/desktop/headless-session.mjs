import { randomUUID } from 'node:crypto';
import { existsSync, realpathSync, readFileSync, writeFileSync, renameSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';
import { run } from './headless-build.mjs';

export const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export function readJson(path) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } }
export function inside(parent, child) {
  if (!existsSync(parent) || !existsSync(child)) return false;
  const suffix = relative(realpathSync(parent), realpathSync(child));
  return suffix !== '' && suffix !== '..' && !suffix.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(suffix);
}
export function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}
export function sessionStatus(root) {
  const base = join(root, '.local/desktop-headless');
  const current = readJson(join(base, 'current.json'));
  if (!current || !existsSync(current.directory) || !inside(join(base, 'sessions'), current.directory)) return { running: false };
  const heartbeat = readJson(join(current.directory, 'heartbeat.json'));
  return { ...current, running: alive(current.pid) && heartbeat?.pid === current.pid && Date.now() - Number(heartbeat.at) < 5_000 };
}

export async function request(session, action, timeoutMs = 30_000) {
  if (!session.running) throw new Error('No active headless session. Run desktop:headless -- start.');
  const id = randomUUID().replaceAll('-', '');
  const temporary = join(session.directory, 'requests', `${id}.tmp`);
  writeFileSync(temporary, JSON.stringify(action));
  renameSync(temporary, join(session.directory, 'requests', `${id}.json`));
  const response = join(session.directory, 'responses', `${id}.json`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = readJson(response);
    if (value) return { ...value, responseFile: response };
    if (!alive(session.pid)) throw new Error('The headless runtime exited before responding. Inspect its native log.');
    await pause(100);
  }
  throw new Error(`Headless request timed out. Session remains available; response may appear later at ${response}`);
}

export async function launchSession(root, executable, profileSource, fingerprint) {
  if (!existsSync(join(profileSource, 'Default'))) throw new Error(`Desktop WebView2 profile not found: ${profileSource}`);
  const directory = join(root, '.local/desktop-headless/sessions', `${Date.now()}-${randomUUID().slice(0, 8)}`);
  for (const name of ['profile', 'requests', 'responses', 'probes']) mkdirSync(join(directory, name), { recursive: true });
  // Chromium caches and lock sentinels are rebuildable. Never stop the live player.
  await run('robocopy.exe', [profileSource, join(directory, 'profile/EBWebView'), '/E', '/R:0', '/W:0', '/XJ',
    '/XF', 'LOCK', 'lockfile', 'SingletonLock', 'SingletonCookie', 'SingletonSocket',
    '/XD', 'Cache', 'Code Cache', 'GPUCache', 'Crashpad', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'], {
    // Robocopy uses 0..7 for successful copying; normalize through its exit event below.
    acceptableExitCodes: [0, 1, 2, 3, 4, 5, 6, 7]
  });
  const stdout = openSync(join(directory, 'native.stdout.log'), 'a');
  const stderr = openSync(join(directory, 'native.stderr.log'), 'a');
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^WEBVIEW2_(USER_DATA_FOLDER|ADDITIONAL_BROWSER_ARGUMENTS|PIPE_FOR_SCRIPT_DEBUGGER|WAIT_FOR_SCRIPT_DEBUGGER)$/i.test(key)) delete env[key];
  let child;
  try {
    child = spawn(executable, [directory], { cwd: root, env, detached: true, windowsHide: true, stdio: ['ignore', stdout, stderr] });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  } finally { closeSync(stdout); closeSync(stderr); }
  child.unref();
  const current = { directory, pid: child.pid, profile: join(directory, 'profile'), fingerprint, startedAt: new Date().toISOString() };
  writeFileSync(join(root, '.local/desktop-headless/current.json'), JSON.stringify(current, null, 2));
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline && alive(child.pid)) {
    const ready = readJson(join(directory, 'ready.json'));
    if (ready) {
      if (ready.visible || !ready.muted) {
        await request({ ...current, running: true }, { action: 'stop' });
        throw new Error('Hidden/muted startup verification failed; the harness was stopped.');
      }
      return { ...current, ...ready, running: true };
    }
    await pause(100);
  }
  if (alive(child.pid)) await request({ ...current, running: true }, { action: 'stop' }).catch(() => child.kill());
  throw new Error(`Hidden runtime did not mount. Inspect ${join(directory, 'native.stderr.log')}`);
}
