import { access, cp, mkdir, readdir, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDirectory = join(projectRoot, 'dist');
const clientDirectory = join(distDirectory, 'client');
const serverDirectory = join(distDirectory, 'server');
const workerSource = join(projectRoot, 'deployment', 'sites-worker.js');

await Promise.all([
  access(join(distDirectory, 'index.html')),
  access(workerSource)
]);

await Promise.all([
  rm(clientDirectory, { recursive: true, force: true }),
  rm(serverDirectory, { recursive: true, force: true })
]);
await mkdir(clientDirectory, { recursive: true });

const entries = await readdir(distDirectory, { withFileTypes: true });
for (const entry of entries) {
  if (entry.name === 'client' || entry.name === 'server' || entry.name === '.openai') {
    continue;
  }

  await rename(join(distDirectory, entry.name), join(clientDirectory, entry.name));
}

await mkdir(serverDirectory, { recursive: true });
await cp(workerSource, join(serverDirectory, 'index.js'));

console.log('Prepared dist/client and dist/server for ChatGPT Sites.');
