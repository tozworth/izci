import { readFile, writeFile } from 'node:fs/promises';

const protocolPath = new URL('../src/lib/services/multiplayer-protocol.ts', import.meta.url);
const rulesPath = new URL('../database.rules.json', import.meta.url);
const checkOnly = process.argv.includes('--check');

const protocolSource = await readFile(protocolPath, 'utf8');
const versionMatch = protocolSource.match(
  /export const MULTIPLAYER_PROTOCOL_VERSION = (\d+);/
);

if (!versionMatch) {
  throw new Error('Could not find MULTIPLAYER_PROTOCOL_VERSION.');
}

const version = versionMatch[1];
const rulesSource = await readFile(rulesPath, 'utf8');
let replacements = 0;
const synchronizedRules = rulesSource
  .replace(/protocolVersion'\)\.val\(\) === \d+/g, (match) => {
    replacements += 1;
    return match.replace(/\d+$/, version);
  })
  .replace(/("protocolVersion": \{ "\.validate": "newData\.val\(\) === )\d+/g, (_, prefix) => {
    replacements += 1;
    return `${prefix}${version}`;
  });

if (replacements !== 3) {
  throw new Error(`Expected to find 3 multiplayer protocol rule checks; found ${replacements}.`);
}

if (synchronizedRules === rulesSource) process.exit(0);

if (checkOnly) {
  throw new Error(`database.rules.json does not use multiplayer protocol version ${version}.`);
}

await writeFile(rulesPath, synchronizedRules);
console.log(`Synchronized Firebase rules to multiplayer protocol version ${version}.`);
