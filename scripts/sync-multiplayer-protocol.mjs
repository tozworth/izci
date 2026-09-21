import { readFile, writeFile } from 'node:fs/promises';

const protocolPath = new URL('../src/lib/services/multiplayer-protocol.ts', import.meta.url);
const rulesPath = new URL('../database.rules.json', import.meta.url);
const sidekickProtocolPath = new URL('../sidekick/internal/protocol/protocol.go', import.meta.url);
const checkOnly = process.argv.includes('--check');

const protocolSource = await readFile(protocolPath, 'utf8');
const majorMatch = protocolSource.match(
  /export const MULTIPLAYER_PROTOCOL_MAJOR = (\d+);/
);
const minorMatch = protocolSource.match(
  /export const MULTIPLAYER_PROTOCOL_MINOR = (\d+);/
);

if (!majorMatch || !minorMatch) {
  throw new Error('Could not find MULTIPLAYER_PROTOCOL_MAJOR/MINOR.');
}

const major = majorMatch[1];
const minor = minorMatch[1];
const rulesSource = await readFile(rulesPath, 'utf8');
let replacements = 0;
const synchronizedRules = rulesSource
  .replace(/protocolMajor'\)\.val\(\) === \d+/g, (match) => {
    replacements += 1;
    return match.replace(/\d+$/, major);
  })
  .replace(/("protocolMajor": \{ "\.validate": "newData[^}]*?===\s*)\d+/g, (_, prefix) => {
    replacements += 1;
    return `${prefix}${major}`;
  })
  .replace(/child\('protocolMajor'\)\.val\(\) === \d+/g, (match) => {
    replacements += 1;
    return match.replace(/\d+$/, major);
  });

if (replacements < 3) {
  throw new Error(`Expected to find at least 3 multiplayer protocol major checks; found ${replacements}.`);
}

const sidekickProtocolSource = await readFile(sidekickProtocolPath, 'utf8');
let sidekickReplacements = 0;
let synchronizedSidekickProtocol = sidekickProtocolSource.replace(
  /(\bMajor\s*=\s*)\d+/g,
  (_, prefix) => {
    sidekickReplacements += 1;
    return `${prefix}${major}`;
  }
);
synchronizedSidekickProtocol = synchronizedSidekickProtocol.replace(
  /(\bMinor\s*=\s*)\d+/g,
  (_, prefix) => {
    sidekickReplacements += 1;
    return `${prefix}${minor}`;
  }
);

if (sidekickReplacements !== 2) {
  throw new Error(`Expected to find Go protocol Major and Minor; found ${sidekickReplacements}.`);
}

const rulesChanged = synchronizedRules !== rulesSource;
const sidekickProtocolChanged = synchronizedSidekickProtocol !== sidekickProtocolSource;

if (!rulesChanged && !sidekickProtocolChanged) process.exit(0);

if (checkOnly) {
  const mismatches = [];
  if (rulesChanged) mismatches.push('database.rules.json');
  if (sidekickProtocolChanged) mismatches.push('sidekick/internal/protocol/protocol.go');
  throw new Error(`${mismatches.join(' and ')} do not use multiplayer protocol ${major}.${minor}.`);
}

await Promise.all([
  rulesChanged ? writeFile(rulesPath, synchronizedRules) : undefined,
  sidekickProtocolChanged ? writeFile(sidekickProtocolPath, synchronizedSidekickProtocol) : undefined
]);
console.log(`Synchronized multiplayer protocol consumers to ${major}.${minor}.`);
