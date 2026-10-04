import { readFileSync, mkdirSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensureHeadlessBuild, sourceFingerprint } from './headless-build.mjs';
import { alive, launchSession, pause, readJson, request, sessionStatus } from './headless-session.mjs';

const root = resolve(import.meta.dirname, '../..');
const [command = 'start', ...args] = process.argv.slice(2);
const usage = 'desktop:headless -- start [--fresh] | status | stop | eval (--expression <JS> | --script <file>) | probe --entry <file.ts>';

function option(name) {
  const index = args.indexOf(name);
  if (index < 0) return null;
  if (!args[index + 1]) throw new Error(`Missing ${name} value. ${usage}`);
  return args[index + 1];
}
function print(value) { console.log(JSON.stringify(value, null, 2)); }

async function stop(session) {
  if (!session.running) return { running: false };
  await request(session, { action: 'stop' });
  const deadline = Date.now() + 10_000;
  while (alive(session.pid) && Date.now() < deadline) await pause(100);
  if (alive(session.pid)) throw new Error('Headless runtime has not exited; no unrelated player was terminated.');
  return { running: false, directory: session.directory };
}

async function probeExpression(session, entry) {
  if (!session.running) throw new Error('No active headless session. Run desktop:headless -- start.');
  const { build } = await import('vite');
  const { svelte } = await import('@sveltejs/vite-plugin-svelte');
  const output = await build({
    configFile: false, root, logLevel: 'error', plugins: [svelte()],
    resolve: { alias: { $lib: join(root, 'src/lib'), $platform: join(root, 'src/desktop/platform.ts') } },
    build: { write: false, minify: false, lib: { entry: resolve(root, entry), name: '__izciHeadlessProbe', formats: ['iife'] } }
  });
  const bundles = (Array.isArray(output) ? output : [output]).flatMap((bundle) => bundle.output);
  const chunks = bundles.filter((item) => item.type === 'chunk');
  if (chunks.length !== 1) throw new Error('A headless probe must bundle to a single script.');
  const { writeFileSync } = await import('node:fs');
  const path = join(session.directory, 'probes', `${randomUUID()}.js`);
  writeFileSync(path, chunks[0].code);
  return `${chunks[0].code}\n; __izciHeadlessProbe.run()`;
}

try {
  if (process.platform !== 'win32') throw new Error('Headless Tauri is Windows-only.');
  let session = sessionStatus(root);
  if (command === 'start') {
    if (args.some((arg) => arg !== '--fresh')) throw new Error(usage);
    const base = join(root, '.local/desktop-headless');
    mkdirSync(base, { recursive: true });
    const lockPath = join(base, 'start.lock');
    if (readJson(lockPath) && !alive(readJson(lockPath).pid)) unlinkSync(lockPath);
    const lock = openSync(lockPath, 'wx');
    try {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(lock, JSON.stringify({ pid: process.pid }));
      session = sessionStatus(root);
      if (session.running && !args.includes('--fresh') && session.fingerprint === sourceFingerprint(root)) {
        print({ ...session, reused: true });
      } else {
        if (session.running) await stop(session);
        const built = await ensureHeadlessBuild(root);
        const source = join(process.env.LOCALAPPDATA, 'app.izci.desktop/EBWebView');
        session = await launchSession(root, built.executable, source, built.fingerprint);
        print({ ...session, cachedBuild: built.cached });
      }
    } finally { closeSync(lock); unlinkSync(lockPath); }
  } else if (command === 'status') {
    if (args.length) throw new Error(usage);
    print(session);
  } else if (command === 'stop') {
    if (args.length) throw new Error(usage);
    print(await stop(session));
  } else if (command === 'eval' || command === 'probe') {
    const timeout = option('--timeout');
    const timeoutMs = timeout === null ? 30_000 : Number(timeout) * 1_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 300_000) throw new Error('--timeout must be 1..300 seconds.');
    if (timeout !== null) args.splice(args.indexOf('--timeout'), 2);
    let expression;
    if (command === 'probe' && args.length === 2 && option('--entry')) expression = await probeExpression(session, option('--entry'));
    else if (command === 'eval' && args.length === 2 && option('--script')) expression = readFileSync(resolve(root, option('--script')), 'utf8');
    else if (command === 'eval' && args.length === 2 && option('--expression')) expression = option('--expression');
    else throw new Error(usage);
    const result = await request(session, { action: 'eval', expression }, timeoutMs);
    const summary = result.evaluation?.result?.value?.summary;
    print(command === 'probe' && summary ? { ok: result.ok, summary, responseFile: result.responseFile } : result);
    if (!result.ok) process.exitCode = 1;
  } else throw new Error(usage);
} catch (error) { console.error(error.message); process.exitCode = 1; }
