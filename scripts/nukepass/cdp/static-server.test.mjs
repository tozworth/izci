import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { startStaticServer } from './static-server.mjs';

test('serves exact build files and rejects traversal and missing routes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'izci-cdp-server-'));
  await writeFile(join(root, 'index.html'), '<h1>izci</h1>');
  const server = await startStaticServer(root);
  try {
    const index = await fetch(`${server.baseUrl}/`);
    assert.equal(index.status, 200);
    assert.match(index.headers.get('content-type'), /^text\/html/);
    assert.equal(await index.text(), '<h1>izci</h1>');

    assert.equal((await fetch(`${server.baseUrl}/missing.html`)).status, 404);
    assert.equal((await fetch(`${server.baseUrl}/%2e%2e/package.json`)).status, 404);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
