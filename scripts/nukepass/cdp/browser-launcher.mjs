import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const STARTUP_TIMEOUT_MS = 30_000;
const MAX_PROCESS_LOG_BYTES = 256 * 1024;

function appendBounded(current, chunk) {
  const next = current + chunk.toString('utf8');
  return next.length > MAX_PROCESS_LOG_BYTES ? next.slice(-MAX_PROCESS_LOG_BYTES) : next;
}

async function readDevToolsPort(profileDirectory, browserProcess, timeoutMs) {
  const filePath = join(profileDirectory, 'DevToolsActivePort');
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (browserProcess.exitCode !== null) {
      throw new Error(`Browser exited before CDP became ready (code ${browserProcess.exitCode})`);
    }
    try {
      const [portLine, browserPath] = (await readFile(filePath, 'utf8')).trim().split(/\r?\n/);
      const port = Number.parseInt(portLine, 10);
      if (Number.isInteger(port) && browserPath?.startsWith('/devtools/browser/')) {
        return { port, browserPath };
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

async function waitForExit(browserProcess, timeoutMs) {
  if (browserProcess.exitCode !== null) return;
  await Promise.race([
    new Promise((resolveExit) => browserProcess.once('exit', resolveExit)),
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, timeoutMs))
  ]);
}

function terminateProcessGroup(browserProcess, signal) {
  if (!browserProcess.pid) return;
  try {
    process.kill(-browserProcess.pid, signal);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

export async function launchBrowser(options) {
  const profileDirectory = await mkdtemp(join(tmpdir(), `izci-cdp-${options.profileId}-`));
  const flags = [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDirectory}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-sync',
    '--metrics-recording-only',
    '--mute-audio',
    '--window-size=1440,1000',
    ...(options.extraFlags ?? []),
    'about:blank'
  ];
  const browserProcess = spawn(options.executable, flags, {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  browserProcess.stdout.on('data', (chunk) => { stdout = appendBounded(stdout, chunk); });
  browserProcess.stderr.on('data', (chunk) => { stderr = appendBounded(stderr, chunk); });

  try {
    const { port, browserPath } = await readDevToolsPort(
      profileDirectory,
      browserProcess,
      options.startupTimeoutMs ?? STARTUP_TIMEOUT_MS
    );
    return {
      profileId: options.profileId,
      profileDirectory,
      port,
      webSocketUrl: `ws://127.0.0.1:${port}${browserPath}`,
      flags,
      process: browserProcess,
      getProcessLogs: () => ({ stdout, stderr }),
      async close({ retainProfile = false } = {}) {
        if (browserProcess.exitCode === null) {
          terminateProcessGroup(browserProcess, 'SIGTERM');
          await waitForExit(browserProcess, 3_000);
        }
        if (browserProcess.exitCode === null) {
          terminateProcessGroup(browserProcess, 'SIGKILL');
          await waitForExit(browserProcess, 1_000);
        }
        browserProcess.stdout.destroy();
        browserProcess.stderr.destroy();
        if (!retainProfile) await rm(profileDirectory, { recursive: true, force: true });
      }
    };
  } catch (error) {
    if (browserProcess.exitCode === null) terminateProcessGroup(browserProcess, 'SIGKILL');
    await waitForExit(browserProcess, 1_000);
    browserProcess.stdout.destroy();
    browserProcess.stderr.destroy();
    if (!options.retainProfileOnFailure) await rm(profileDirectory, { recursive: true, force: true });
    error.processLogs = { stdout, stderr };
    throw error;
  }
}
