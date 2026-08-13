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
  sourceFiles: [],
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
  assert.equal(report.mode, 'ratcheted');
  assert.equal(report.imports.internalEdges, 3);
  assert.deepEqual(report.cycles.stronglyConnectedComponents, [[
    'src/lib/services/service.ts',
    'src/lib/stores/state.ts'
  ]]);
  assert.ok(report.directionViolations.findings.some((finding) => finding.rule === 'presentation-bypasses-application'));
  assert.ok(report.directionViolations.findings.some((finding) => finding.rule === 'store-imports-service'));
  assert.deepEqual(report.browserGlobalAccess.findings, [{
    scope: 'production',
    runtime: 'browser',
    file: 'src/App.svelte',
    global: 'window',
    lines: [3],
    applicable: true,
    allowed: false
  }]);
  assert.ok(report.possibleUnreferencedExports.findings.some((finding) => finding.file.endsWith('state.ts') && finding.name === 'unusedValue'));
  assert.ok(!report.possibleUnreferencedExports.findings.some((finding) => finding.name === 'publicValue'));
});

test('tracks browser globals through nested scopes and destructuring without file-wide suppression', async (t) => {
  const root = await fixture({
    'src/mixed.js': [
      'window.name = "global";',
      'setTimeout(() => history.back(), 1);',
      'function shadowed({ window, timer: setTimeout }) {',
      '  window.name = "local";',
      '  setTimeout(() => location.reload(), 1);',
      '  { const { history } = window; history.back(); }',
      '  history.back();',
      '}',
      'location.reload();',
      'void shadowed;',
      ''
    ].join('\n'),
    'src/types.ts': [
      'interface window { name: string }',
      'type history = { back(): void };',
      'window.name = "still global";',
      'history.back();',
      ''
    ].join('\n')
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const report = await analyzeProject({ root, config: fixtureConfig, includeBundle: false });
  assert.ok(report.source.files.includes('src/mixed.js'));
  assert.deepEqual(report.browserGlobalAccess.findings, [
    { scope: 'production', runtime: 'browser', file: 'src/mixed.js', global: 'history', lines: [2, 7], applicable: true, allowed: false },
    { scope: 'production', runtime: 'browser', file: 'src/mixed.js', global: 'location', lines: [5, 9], applicable: true, allowed: false },
    { scope: 'production', runtime: 'browser', file: 'src/mixed.js', global: 'setTimeout', lines: [2], applicable: true, allowed: false },
    { scope: 'production', runtime: 'browser', file: 'src/mixed.js', global: 'window', lines: [1], applicable: true, allowed: false },
    { scope: 'production', runtime: 'browser', file: 'src/types.ts', global: 'history', lines: [4], applicable: true, allowed: false },
    { scope: 'production', runtime: 'browser', file: 'src/types.ts', global: 'window', lines: [3], applicable: true, allowed: false }
  ]);
});

test('enforces reconstructed contract, runtime capability, wire leaf, and cycle ratchets', async (t) => {
  const root = await fixture({
    'src/lib/contracts/catalog.ts': 'import { value } from "../services/catalog";\nwindow.name = String(value);\nexport const item = value;\n',
    'src/lib/application/page-entry.ts': 'export const bootstrap = true;\n',
    'src/lib/logging/runtime.ts': 'import { value } from "../services/catalog";\nexport const logging = value;\n',
    'src/lib/settings/engine.ts': 'import { value } from "../services/catalog";\nexport const settings = value;\n',
    'src/lib/services/catalog.ts': 'import { item } from "../contracts/catalog";\nimport { bootstrap } from "../application/page-entry";\nexport const value = item ?? bootstrap;\n',
    'src/lib/services/multiplayer-protocol.ts': 'import { item } from "../contracts/catalog";\nexport const wire = item;\n',
    'src/lib/runtime/scope.ts': 'import { value } from "../services/catalog";\nexport const scope = value;\n'
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const report = await analyzeProject({ root, config: fixtureConfig, includeBundle: false });
  assert.equal(report.enforcement.direction.count, 6);
  assert.equal(report.enforcement.browserGlobals.count, 1);
  assert.equal(report.enforcement.capabilities.count, 0);
  assert.equal(report.enforcement.cycles.count, 1);
  assert.equal(report.enforcement.violations, 8);
  assert.deepEqual(
    report.enforcement.direction.findings.map((finding) => finding.rule),
    [
      'contract-imports-implementation',
      'implementation-imports-page-bootstrap',
      'logging-core-imports-application',
      'runtime-imports-application',
      'settings-imports-application',
      'wire-imports-internal-module'
    ]
  );
});

test('enforces typed persistence and convergent settings capability ownership', async (t) => {
  const root = await fixture({
    'src/lib/persistence/browser-indexed-db.ts': 'window.indexedDB.open("allowed");\n',
    'src/lib/persistence/indexed-db.ts': 'export const kernel = true;\n',
    'src/lib/services/artwork-cache.ts': 'indexedDB.open("bypass");\n',
    'src/lib/services/backups.ts': 'localStorage.setItem("raw", "value");\n',
    'src/lib/stores/appearance-settings.ts': 'new BroadcastChannel("raw");\nlocalStorage.getItem("raw");\n',
    'src/lib/services/catalog.ts': 'export const value = 1;\n'
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const report = await analyzeProject({ root, config: fixtureConfig, includeBundle: false });
  assert.deepEqual(report.enforcement.capabilities.findings.map((finding) => [
    finding.rule, finding.file, finding.global
  ]), [
    ['backup-bypasses-settings-owner', 'src/lib/services/backups.ts', 'localStorage'],
    ['idb-owner-bypasses-persistence-kernel', 'src/lib/services/artwork-cache.ts', 'indexedDB'],
    ['settings-owner-bypasses-settings-engine', 'src/lib/stores/appearance-settings.ts', 'BroadcastChannel'],
    ['settings-owner-bypasses-settings-engine', 'src/lib/stores/appearance-settings.ts', 'localStorage']
  ]);
  assert.ok(!report.enforcement.browserGlobals.findings.some((finding) =>
    finding.file === 'src/lib/persistence/browser-indexed-db.ts'
  ));
});

test('includes configured root runtime sources and parses JavaScript imports', async (t) => {
  const root = await fixture({
    'src/shared.js': 'export const value = 1;\n',
    'vite.config.ts': 'import { value } from "./src/shared.js";\nexport default value;\n',
    'sites-worker.js': 'import { value } from "./src/shared.js";\nself.value = value;\n'
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = { ...fixtureConfig, sourceFiles: ['sites-worker.js', 'vite.config.ts'] };
  const report = await analyzeProject({ root, config, includeBundle: false });
  assert.deepEqual(report.source.files, ['sites-worker.js', 'src/shared.js', 'vite.config.ts']);
  assert.equal(report.imports.internalEdges, 2);
  assert.deepEqual(report.browserGlobalAccess.findings, [
    { scope: 'production', runtime: 'worker', file: 'sites-worker.js', global: 'self', lines: [2], applicable: true, allowed: false }
  ]);
});

test('classifies execution realms and isolates vendor and Node-build global observations', async (t) => {
  const root = await fixture({
    'public/raf-upward-compressor.worklet.js': 'class Processor extends AudioWorkletProcessor { process() { return sampleRate > 0; } }\nregisterProcessor("raf", Processor);\n',
    'public/vendor/ahx-worklet.js': 'class Processor extends AudioWorkletProcessor {}\nWebAssembly.compile(new Uint8Array());\nregisterProcessor("ahx", Processor);\n',
    'src/App.svelte': '<script>window.name = "app";</script>\n',
    'src/render.worker.ts': 'self.postMessage("ready");\n',
    'src/lib/vendor/chiptune3/runtime.js': 'window.name = "vendor";\n',
    'vite.config.ts': 'const base = new URL(".", import.meta.url);\nexport default { base };\n'
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = {
    ...fixtureConfig,
    sourceFiles: ['public/raf-upward-compressor.worklet.js', 'public/vendor/ahx-worklet.js', 'vite.config.ts']
  };
  const report = await analyzeProject({ root, config, includeBundle: false });

  assert.deepEqual(report.source.runtimes, {
    browser: ['src/App.svelte'],
    'node-build': ['vite.config.ts'],
    vendor: ['public/vendor/ahx-worklet.js', 'src/lib/vendor/chiptune3/runtime.js'],
    worker: ['public/raf-upward-compressor.worklet.js', 'src/render.worker.ts']
  });
  assert.ok(report.source.entrypoints.includes('public/raf-upward-compressor.worklet.js'));
  assert.ok(report.source.entrypoints.includes('public/vendor/ahx-worklet.js'));
  assert.deepEqual(report.browserGlobalAccess.byRuntime, {
    browser: { applicable: true, files: 1, productionFiles: 1, testFiles: 0, observations: 1, violations: 1 },
    'node-build': { applicable: false, files: 1, productionFiles: 1, testFiles: 0, observations: 1, violations: 0 },
    vendor: { applicable: false, files: 2, productionFiles: 2, testFiles: 0, observations: 4, violations: 0 },
    worker: { applicable: true, files: 2, productionFiles: 2, testFiles: 0, observations: 4, violations: 4 }
  });
  assert.equal(report.browserGlobalAccess.violations, 5);
  assert.ok(report.browserGlobalAccess.findings.some((finding) => finding.runtime === 'vendor' && finding.global === 'window' && !finding.applicable));
  assert.ok(report.browserGlobalAccess.findings.some((finding) => finding.file === 'public/vendor/ahx-worklet.js' && finding.global === 'AudioWorkletProcessor'));
});

test('reports production modules with no production inbound edge and preserves test-only inbound facts', async (t) => {
  const root = await fixture({
    'src/main.ts': 'import { live } from "./live";\nvoid live;\n',
    'src/live.ts': 'export const live = true;\n',
    'src/test-only.ts': 'export const helper = true;\n',
    'src/test-only.test.ts': 'import { helper } from "./test-only";\nvoid helper;\n',
    'src/orphan.ts': 'export const orphan = true;\n',
    'src/render.worker.ts': 'export {};\n'
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const report = await analyzeProject({ root, config: fixtureConfig, includeBundle: false });

  assert.ok(!report.possibleUnreferencedModules.findings.some((finding) => finding.file === 'src/main.ts'));
  assert.ok(!report.possibleUnreferencedModules.findings.some((finding) => finding.file === 'src/render.worker.ts'));
  assert.ok(!report.possibleUnreferencedModules.findings.some((finding) => finding.file === 'src/live.ts'));
  assert.ok(!report.possibleUnreferencedModules.findings.some((finding) => finding.file === 'src/test-only.test.ts'));
  assert.deepEqual(report.possibleUnreferencedModules.findings, [
    {
      file: 'src/orphan.ts',
      runtime: 'browser',
      productionInboundEdges: 0,
      productionImporters: [],
      testInboundEdges: 0,
      testImporters: []
    },
    {
      file: 'src/test-only.ts',
      runtime: 'browser',
      productionInboundEdges: 0,
      productionImporters: [],
      testInboundEdges: 1,
      testImporters: ['src/test-only.test.ts']
    }
  ]);
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
