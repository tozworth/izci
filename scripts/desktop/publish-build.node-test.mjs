import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { publishDesktopBuild } from './publish-build.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'izci-publish-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.local', 'desktop'), { recursive: true });
  const executable = join(root, '.local', 'desktop', 'izci.exe');
  const staging = join(root, '.local', 'staging.exe');
  writeFileSync(executable, 'previous build');
  writeFileSync(staging, 'verified build');
  return { root, executable, staging };
}

test('installs the completed build before relaunching a running fallback copy', async (t) => {
  const { root, executable, staging } = fixture(t);
  const previous = join(root, '.local', 'desktop-next', 'izci.exe');
  let stopped = false;
  let launched = false;
  await publishDesktopBuild(root, staging, {
    stop: (workspace) => {
      assert.equal(workspace, root);
      assert.equal(readFileSync(executable, 'utf8'), 'previous build');
      stopped = true;
      return [previous];
    },
    start: async (path) => {
      assert.ok(stopped);
      assert.equal(path, executable);
      assert.equal(readFileSync(path, 'utf8'), 'verified build');
      launched = true;
    },
  });
  assert.ok(launched);
});

test('a build does not launch izci when no local player was running', async (t) => {
  const { root, executable, staging } = fixture(t);
  await publishDesktopBuild(root, staging, {
    stop: () => [], start: () => assert.fail('idle build launched a player'),
  });
  assert.equal(readFileSync(executable, 'utf8'), 'verified build');
});

test('failed replacement preserves and relaunches the previous executable', async (t) => {
  const { root, executable, staging } = fixture(t);
  const failure = new Error('file is still locked');
  let recovered = false;
  await assert.rejects(publishDesktopBuild(root, staging, {
    stop: () => [executable],
    replace: () => { throw failure; },
    start: async (path) => {
      assert.equal(path, executable);
      assert.equal(readFileSync(path, 'utf8'), 'previous build');
      recovered = true;
    },
  }), (error) => error === failure);
  assert.ok(recovered);
  assert.equal(readFileSync(staging, 'utf8'), 'verified build');
});

test('shutdown failure leaves the existing executable untouched', async (t) => {
  const { root, executable, staging } = fixture(t);
  await assert.rejects(publishDesktopBuild(root, staging, {
    stop: () => { throw new Error('shutdown failed'); },
    start: () => assert.fail('shutdown failure launched a player'),
  }), /shutdown failed/);
  assert.equal(readFileSync(executable, 'utf8'), 'previous build');
});
