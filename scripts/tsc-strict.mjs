// Strict dead-import detector: tsc --noEmit with noUnusedLocals /
// noUnusedParameters over src/**/*.ts (svelte files are svelte-check's job).
// Exits nonzero while unused imports/locals/params remain.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const configPath = fileURLToPath(new URL('./tsconfig.strict.json', import.meta.url));

const child = spawn('node_modules/.bin/tsc', ['--noEmit', '-p', configPath], {
  cwd: repoRoot
});
let out = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (out += d));
const code = await new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('close', resolve);
});

const byCode = new Map();
for (const m of out.matchAll(/error TS(\d+)/g)) {
  byCode.set(m[1], (byCode.get(m[1]) ?? 0) + 1);
}
const total = [...byCode.values()].reduce((a, b) => a + b, 0);
console.log(`tsc --noEmit (noUnusedLocals/noUnusedParameters): ${total} error(s)`);
for (const [code, count] of [...byCode.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  TS${code}: ${count}`);
}
if (total > 0) {
  console.log('\nFirst errors:');
  console.log(out.split('\n').slice(0, 12).join('\n'));
}
process.exit(total > 0 ? 1 : 0);
