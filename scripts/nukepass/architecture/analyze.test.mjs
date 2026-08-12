import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { analyzeProject, serializeReport } from './analyze.mjs';
import { architectureConfig } from './config.mjs';

async function fixture(files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'izci-architecture-'));
  await Promise.all(Object.entries(files).map(async ([file, source]) => {
    const destination = path.join(root, file);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, source, 'utf8');
  }));
  return root;
}

const fixtureConfig = {
  ...architectureConfig,
  sourceRoots: ['src'],
  directionRules: architectureConfig.directionRules,
  bundleDirectory: 'dist'
};

test('maps imports, direction violations, cycles, globals, and conservative unused exports', async (t) => {
  const root = await fixture({
    'src/App.svelte': '<script lang="ts">\nimport { publicValue } from "$lib/stores/state";\nwindow.name = String(publicValue);\n</script>\n',
    'src/lib/stores/state.ts': 'import { serviceValue } from "../services/service";\nexport const publicValue = serviceValue;\nexport const unusedValue = 2;\n',
    'src/lib/services/service.ts': 'import { publicValue } from "../stores/state";\nexport const serviceValue = publicValue ?? 1;\n',
    'src/lib/services/shadowed.ts': 'export function read(window: { name: string }) { return window.name; }\n'
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const report = await analyzeProject({ root, config: fixtureConfig, includeBundle: false });
  assert.equal(report.mode, 'informational');
  assert.equal(report.imports.internalEdges, 3);
  assert.deepEqual(report.cycles.stronglyConnectedComponents, [[
    'src/lib/services/service.ts',
    'src/lib/stores/state.ts'
  ]]);
  assert.ok(report.directionViolations.findings.some((finding) => finding.rule === 'presentation-bypasses-application'));
  assert.ok(report.directionViolations.findings.some((finding) => finding.rule === 'store-imports-service'));
  assert.deepEqual(report.browserGlobalAccess.findings, [{
    scope: 'production',
    file: 'src/App.svelte',
    global: 'window',
    lines: [3],
    allowed: false
  }]);
  assert.ok(report.possibleUnreferencedExports.findings.some((finding) => finding.file.endsWith('state.ts') && finding.name === 'unusedValue'));
  assert.ok(!report.possibleUnreferencedExports.findings.some((finding) => finding.name === 'publicValue'));
});

test('suppresses dead-export guesses for namespace and dynamic consumers', async (t) => {
  const root = await fixture({
    'src/lib/a.ts': 'export const one = 1;\nexport const two = 2;\n',
    'src/lib/namespace.ts': 'import * as values from "./a";\nvoid values.one;\n',
    'src/lib/lazy.ts': 'void import("./a");\n'
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const report = await analyzeProject({ root, config: fixtureConfig, includeBundle: false });
  assert.deepEqual(report.possibleUnreferencedExports.findings, []);
});

test('treats named default declarations only as default exports', async (t) => {
  const root = await fixture({
    'src/lib/defaulted.ts': 'export default function locallyNamed() { return 1; }\n',
    'src/lib/consumer.ts': 'import value from "./defaulted";\nvoid value;\n'
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const report = await analyzeProject({ root, config: fixtureConfig, includeBundle: false });
  assert.deepEqual(report.possibleUnreferencedExports.findings, []);
});

test('reports deterministic bundle byte and precache facts without timestamps', async (t) => {
  const root = await fixture({
    'src/main.ts': 'export {};\n',
    'dist/index.html': '<main></main>\n',
    'dist/assets/z.js': '12345',
    'dist/assets/a.js': '123',
    'dist/sw.js': 'precacheAndRoute([{url:"assets/z.js",revision:"abc"},{url:"index.html",revision:null}]);'
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const first = await analyzeProject({ root, config: fixtureConfig });
  const second = await analyzeProject({ root, config: fixtureConfig });
  assert.equal(serializeReport(first), serializeReport(second));
  assert.equal(first.bundle.status, 'present');
  assert.deepEqual(first.bundle.largestJavaScript.map((item) => item.path), ['sw.js', 'assets/z.js', 'assets/a.js']);
  assert.deepEqual(first.bundle.precache.assets, [
    { url: 'assets/z.js', revision: 'abc' },
    { url: 'index.html', revision: null }
  ]);
});

test('invalid config and missing roots are reporter errors', async () => {
  await assert.rejects(() => analyzeProject({ config: { ...fixtureConfig, sourceRoots: [] } }), /at least one source root/);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'izci-architecture-missing-'));
  await assert.rejects(() => analyzeProject({ root, config: fixtureConfig }), /source root does not exist/);
  await fs.rm(root, { recursive: true, force: true });
});
