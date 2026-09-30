import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = readFileSync(resolve(root, 'src/lib/types.ts'), 'utf8');
function extensions(name) {
  const body = source.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const;`))?.[1];
  if (!body) throw new Error(`Missing canonical extension list: ${name}`);
  return [...body.matchAll(/\.\.\.([A-Z_]+)|'([^']+)'/g)].flatMap((match) => match[1] ? extensions(match[1]) : [match[2]]);
}
const formats = Object.fromEntries(['STREAM', 'MODULE', 'VIDEO', 'IMAGE'].flatMap((kind) =>
  extensions(`${kind}_EXTENSIONS`).map((extension) => [extension, kind.toLowerCase()])));
const path = resolve(root, 'src-tauri/media-formats.json');
const expected = `${JSON.stringify(formats, null, 2)}\n`;
if (process.argv.includes('--check')) {
  if (readFileSync(path, 'utf8').replaceAll('\r\n', '\n') !== expected) throw new Error('Run node scripts/sync-desktop-formats.mjs');
} else { writeFileSync(path, expected); }
