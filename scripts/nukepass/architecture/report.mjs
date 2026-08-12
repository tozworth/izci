#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { analyzeProject, serializeReport } from './analyze.mjs';

function usage() {
  return 'Usage: node scripts/nukepass/architecture/report.mjs [--root <directory>] [--out <file>] [--no-bundle]';
}

function parseArguments(arguments_) {
  const options = { root: process.cwd(), output: null, includeBundle: true };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--help' || argument === '-h') return { help: true };
    if (argument === '--no-bundle') options.includeBundle = false;
    else if (argument === '--root' || argument === '--out') {
      const value = arguments_[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value.`);
      index += 1;
      if (argument === '--root') options.root = path.resolve(value);
      else options.output = path.resolve(value);
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
  } else {
    const report = await analyzeProject({ root: options.root, includeBundle: options.includeBundle });
    const json = serializeReport(report);
    if (options.output) {
      await fs.mkdir(path.dirname(options.output), { recursive: true });
      await fs.writeFile(options.output, json, 'utf8');
    } else process.stdout.write(json);
  }
} catch (error) {
  process.stderr.write(`Architecture reporter error: ${error instanceof Error ? error.message : String(error)}\n${usage()}\n`);
  process.exitCode = 1;
}
