import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { run, sourceFingerprint } from './headless-build.mjs';
import { inside, pause, request, sessionStatus } from './headless-session.mjs';

function fixture(t) {
  const base = resolve(import.meta.dirname, '../../.local/headless-tests');
  mkdirSync(base, { recursive: true });
  const root = mkdtempSync(join(base, 'session-'));
  t.after(() => { assert.ok(inside(base, root)); rmSync(root, { recursive: true, force: true }); });
  return root;
}

test('fingerprint includes native/frontend/probe inputs and ignores Cargo output and optional server sources', (t) => {
  const root = fixture(t);
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'src-tauri/target'), { recursive: true });
  writeFileSync(join(root, 'src/runtime.ts'), 'before');
  const before = sourceFingerprint(root);
  writeFileSync(join(root, 'src-tauri/target/generated'), 'ignored');
  assert.equal(sourceFingerprint(root), before);
  mkdirSync(join(root, 'izci-server'), { recursive: true });
  writeFileSync(join(root, 'izci-server/go.mod'), 'ignored');
  assert.equal(sourceFingerprint(root), before);
  writeFileSync(join(root, 'src/runtime.ts'), 'after');
  assert.notEqual(sourceFingerprint(root), before);
  const runtimeChanged = sourceFingerprint(root);
  mkdirSync(join(root, 'pages'));
  writeFileSync(join(root, 'pages/index.html'), '<div id="app"></div>');
  assert.notEqual(sourceFingerprint(root), runtimeChanged);
  const pageAdded = sourceFingerprint(root);
  writeFileSync(join(root, 'pages/index.html'), '<div id="app">changed</div>');
  assert.notEqual(sourceFingerprint(root), pageAdded);
});

test('status refuses session paths outside the owned sessions directory', (t) => {
  const root = fixture(t);
  const base = join(root, '.local/desktop-headless');
  mkdirSync(join(base, 'sessions'), { recursive: true });
  const outside = join(root, 'outside');
  mkdirSync(outside);
  writeFileSync(join(base, 'current.json'), JSON.stringify({ directory: outside, pid: process.pid }));
  writeFileSync(join(outside, 'heartbeat.json'), JSON.stringify({ pid: process.pid, at: Date.now() }));
  assert.deepEqual(sessionStatus(root), { running: false });
  assert.equal(inside(join(base, 'sessions'), join(base, 'sessions')), false);
});

test('status requires both a live process and its fresh heartbeat', (t) => {
  const root = fixture(t);
  const base = join(root, '.local/desktop-headless');
  const directory = join(base, 'sessions/one');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(base, 'current.json'), JSON.stringify({ directory, pid: process.pid }));
  writeFileSync(join(directory, 'heartbeat.json'), JSON.stringify({ pid: process.pid, at: Date.now() }));
  assert.equal(sessionStatus(root).running, true);
  writeFileSync(join(directory, 'heartbeat.json'), JSON.stringify({ pid: process.pid, at: Date.now() - 10_000 }));
  assert.equal(sessionStatus(root).running, false);
});

test('requests use opaque names, preserve expressions, and return the saved response', async (t) => {
  const directory = fixture(t);
  mkdirSync(join(directory, 'requests'));
  mkdirSync(join(directory, 'responses'));
  const expression = "(async () => ({text: 'Unicode şarkı', value: 2}))()";
  const pending = request({ directory, pid: process.pid, running: true }, { action: 'eval', expression });
  await pause(20);
  const [filename] = readdirSync(join(directory, 'requests'));
  assert.match(filename, /^[a-f0-9]{32}\.json$/);
  assert.deepEqual(JSON.parse(readFileSync(join(directory, 'requests', filename), 'utf8')), { action: 'eval', expression });
  writeFileSync(join(directory, 'responses', filename), JSON.stringify({ ok: true, evaluation: { result: { value: 2 } } }));
  const response = await pending;
  assert.equal(response.ok, true);
  assert.equal(response.responseFile, join(directory, 'responses', filename));
});

test('process runner understands Robocopy success codes but rejects actual failures', async () => {
  assert.equal(await run(process.execPath, ['-e', "process.stdout.write('copied'); process.exit(1)"], { acceptableExitCodes: [0, 1] }), 'copied');
  await assert.rejects(run(process.execPath, ['-e', 'process.exit(8)'], { acceptableExitCodes: [0, 1] }), /failed \(8\)/);
});
