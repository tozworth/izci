// Bundle report: builds the app and writes docs/bundle-report.md.
// Parses the Vite chunk table and the vite-plugin-pwa precache summary from
// the build output. Zero dependencies; mirrors scripts/*.mjs style.
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const reportPath = fileURLToPath(new URL('../docs/bundle-report.md', import.meta.url));

const ANSI_RE = /[\u001b\u009b][[()#;?]*(?:\d{1,4}(?:;\d{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
const CHUNK_RE = /^\s*(dist\/\S+)\s+([\d.]+) kB\s+│\s+gzip:\s+([\d.]+) kB\s*$/gm;
const PRECACHE_RE = /precache\s+(\d+)\s+entries\s+\(([\d.]+)\s+KiB\)/;
const WARNING_RE = /Some chunks are larger than 500 kB/;

function runBuild() {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', 'build'], { cwd: repoRoot });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out }));
  });
}

const { code, out } = await runBuild();
if (code !== 0) throw new Error(`npm run build failed with exit code ${code}`);

const plain = out.replace(ANSI_RE, '');
const chunks = [...plain.matchAll(CHUNK_RE)].map((m) => ({
  name: m[1].replace(/^dist\//, ''),
  minified: Number(m[2]),
  gzip: Number(m[3])
}));
const precache = plain.match(PRECACHE_RE);
const warningPresent = WARNING_RE.test(plain);

chunks.sort((a, b) => b.minified - a.minified);
const overLimit = chunks.filter((c) => /\.(js|mjs)$/.test(c.name) && c.minified > 500);

const rows = chunks
  .map((c) => {
    const flag = /\.(js|mjs)$/.test(c.name) && c.minified > 500 ? '⚠ >500 kB' : '';
    return `| ${c.name} | ${c.minified.toFixed(2)} | ${c.gzip.toFixed(2)} | ${flag} |`;
  })
  .join('\n');

const md = [
  '# Bundle report',
  '',
  `Generated ${new Date().toISOString()} by \`scripts/bundle-report.mjs\` (\`npm run build\`).`,
  '',
  `- Precache: ${precache ? `${precache[1]} entries, ${precache[2]} KiB total` : 'not reported'}.`,
  `- Chunk size warning (>500 kB after minification): ${warningPresent ? 'present' : 'absent'}.`,
  `- Chunks over 500 kB: ${overLimit.length ? overLimit.map((c) => `${c.name} (${c.minified.toFixed(2)} kB)`).join(', ') : 'none'}.`,
  '',
  '| Chunk | Minified (kB) | Gzip (kB) | Flag |',
  '|---|---|---|---|',
  rows,
  ''
].join('\n');

await writeFile(reportPath, md);
console.log(`Wrote ${reportPath}`);
console.log(
  `${chunks.length} chunks, precache ${precache ? `${precache[1]} entries / ${precache[2]} KiB` : 'n/a'}, ` +
    `${overLimit.length} over 500 kB`
);
