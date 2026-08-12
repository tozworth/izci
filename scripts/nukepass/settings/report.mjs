#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { analyzeSettings, serializeSettingsReport } from './analyze.mjs';

const usage = 'Usage: node scripts/nukepass/settings/report.mjs [--root <directory>] [--out <file>]';

function argumentsFrom(values) {
  const options = { root: process.cwd(), output: null };
  for (let index = 0; index < values.length; index += 1) {
    const argument = values[index];
    if (argument === '-h' || argument === '--help') return { help: true };
    if (argument !== '--root' && argument !== '--out') throw new Error(`Unknown argument: ${argument}`);
    const value = values[++index];
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value.`);
    if (argument === '--root') options.root = path.resolve(value);
    else options.output = path.resolve(value);
  }
  return options;
}

try {
  const options = argumentsFrom(process.argv.slice(2));
  if (options.help) process.stdout.write(`${usage}\n`);
  else {
    const json = serializeSettingsReport(await analyzeSettings({ root: options.root }));
    if (options.output) {
      await fs.mkdir(path.dirname(options.output), { recursive: true });
      await fs.writeFile(options.output, json, 'utf8');
    } else process.stdout.write(json);
  }
} catch (error) {
  process.stderr.write(`Settings reporter error: ${error instanceof Error ? error.message : String(error)}\n${usage}\n`);
  process.exitCode = 1;
}
