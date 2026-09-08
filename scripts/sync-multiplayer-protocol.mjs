import { readFile, writeFile } from 'node:fs/promises';

const protocolPath = new URL('../src/lib/services/multiplayer-protocol.ts', import.meta.url);
const rulesPath = new URL('../database.rules.json', import.meta.url);
const sidekickServerPath = new URL('../sidekick/internal/server/server.go', import.meta.url);
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

const sidekickServerSource = await readFile(sidekickServerPath, 'utf8');
let sidekickReplacements = 0;
const synchronizedSidekickServer = sidekickServerSource.replace(
  /(\bAppProtocolVersion\s*=\s*)\d+/g,
  (_, prefix) => {
    sidekickReplacements += 1;
    return `${prefix}${version}`;
  }
);

if (sidekickReplacements !== 1) {
  throw new Error(`Expected to find 1 Sidekick app protocol version; found ${sidekickReplacements}.`);
}

const rulesChanged = synchronizedRules !== rulesSource;
const sidekickServerChanged = synchronizedSidekickServer !== sidekickServerSource;

if (!rulesChanged && !sidekickServerChanged) process.exit(0);

if (checkOnly) {
  const mismatches = [];
  if (rulesChanged) mismatches.push('database.rules.json');
  if (sidekickServerChanged) mismatches.push('sidekick/internal/server/server.go');
  throw new Error(`${mismatches.join(' and ')} do not use multiplayer protocol version ${version}.`);
}

await Promise.all([
  rulesChanged ? writeFile(rulesPath, synchronizedRules) : undefined,
  sidekickServerChanged ? writeFile(sidekickServerPath, synchronizedSidekickServer) : undefined
]);
console.log(`Synchronized multiplayer protocol consumers to version ${version}.`);
