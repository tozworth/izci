import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildFileIcons } from './desktop/file-icons.mjs';

const directory = resolve(import.meta.dirname, '../src-tauri/icons/file-types');
if (process.argv.slice(2).some((arg) => arg !== '--check')) throw new Error('Usage: node scripts/sync-desktop-file-icons.mjs [--check]');
const check = process.argv.includes('--check');
const outputs = buildFileIcons(directory);
for (const [name, bytes] of outputs) {
  const path = join(directory, name);
  const current = existsSync(path) ? readFileSync(path) : null;
  if (current?.equals(bytes)) continue;
  if (check) throw new Error(`Stale file icon: ${name}. Run npm run desktop:icons.`);
  writeFileSync(path, bytes);
}
console.log(`${check ? 'Verified' : 'Generated'} ${outputs.size / 2} file icons, each with 16/24/32/48/64/128/256 px frames.`);
